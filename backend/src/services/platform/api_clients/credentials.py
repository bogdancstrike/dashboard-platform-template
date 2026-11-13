"""Client fields, scopes, and minting and hashing secrets."""

from __future__ import annotations

import hashlib
import re
import secrets
from typing import Any

from sqlalchemy import Select, select

from src.core import vocabulary
from src.core.auth import ALL_PERMISSIONS
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.query import Field, FieldSet

#: Reading and writing are the same privilege here, and deliberately so: a
#: client's scopes and its allowed addresses are exactly the information
#: somebody would want before attacking it.
PERMISSION = "api.manage"


#: How long a rotated-out credential keeps working.
#:
#: Not zero, because a rotation that killed the old secret the instant a new
#: one was minted is an outage with extra steps — every caller holding the old
#: key fails until it is redeployed. Not forever either, or "rotate" would mean
#: "mint a second key". Seven days is long enough for a deploy and short enough
#: to be a deadline.
ROTATION_GRACE_DAYS = 7


#: The plaintext shape. A recognisable prefix makes a leaked key greppable in
#: logs and searchable on a paste site, which is worth more than the entropy
#: those characters would have added.
SECRET_PREFIX = "nuc_"


SECRET_BYTES = 32


#: How many logged requests one client's detail returns. A window, not a
#: history — `/admin/logs` is where a long tail belongs.
MAX_REQUESTS = 50


_NAME = re.compile(r"^[\w][\w \-&'/().]{1,159}$", re.UNICODE)


_LABEL = re.compile(r"^[\w][\w \-&'/().]{1,119}$", re.UNICODE)


def _fields() -> FieldSet:
    """Built lazily so importing this module does not pull the models at boot."""
    from src.models.platform import ApiClient

    return FieldSet(
        Field("name", ApiClient.name, searchable=True),
        Field("client_id", ApiClient.client_id, searchable=True, label="Client ID"),
        Field("description", ApiClient.description, searchable=True),
        Field("status", ApiClient.status, kind="enum", facet=True,
              choices=vocabulary.API_CLIENT_STATUS),
        Field("scopes", ApiClient.scopes, kind="array"),
        Field("requests_total", ApiClient.requests_total, kind="number",
              label="Requests (lifetime)"),
        Field("error_rate", ApiClient.error_rate, kind="number", label="Error rate"),
        Field("last_used_at", ApiClient.last_used_at, kind="datetime", label="Last used"),
        Field("created_at", ApiClient.created_at, kind="datetime", label="Created"),
        Field("id", ApiClient.id, kind="uuid", label="Client ID (internal)"),
    )


DEFAULT_COLUMNS = ("name", "status", "scopes", "requests_total", "last_used_at")


def _statement() -> Select:
    from src.models.platform import ApiClient

    return select(ApiClient).where(ApiClient.deleted_at.is_(None))


def _checked(value: Any, pattern: re.Pattern[str], what: str) -> str:
    text = str(value or "").strip()
    if not pattern.match(text):
        raise ValidationError(
            f"A {what} needs 2 or more characters, starting with a letter or digit.",
            details={"value": text},
        )
    return text


def _checked_scopes(value: Any, *, principal) -> list[str]:
    """The scopes a client may be given, bounded by the caller's own.

    Two refusals, and the second is the one that matters. An unknown scope is a
    typo that would silently grant nothing. A scope the *caller* does not hold
    is an escalation: scopes come from the permission catalogue, so granting one
    to a machine is granting a permission, and without this `api.manage` would
    be worth everything in the catalogue.
    """
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValidationError("scopes must be a list of permission codes.")

    wanted = sorted({str(item).strip() for item in value if str(item).strip()})
    unknown = [scope for scope in wanted if scope not in ALL_PERMISSIONS]
    if unknown:
        raise ValidationError(
            f"No endpoint checks for {', '.join(unknown)}.",
            details={"unknown": unknown},
        )

    beyond = [scope for scope in wanted if not principal.can(scope)]
    if beyond:
        raise ValidationError(
            "You cannot give a client a permission you do not hold yourself: "
            + ", ".join(beyond)
            + ".",
            details={"beyond_your_own": beyond},
        )
    return wanted


def _mint() -> tuple[str, str, str]:
    """A new secret: the plaintext, its prefix, and its hash.

    Returned together and *once*: the caller hands the plaintext to the person
    who asked and keeps only the hash. Nothing here can reproduce it.
    """
    plaintext = f"{SECRET_PREFIX}{secrets.token_urlsafe(SECRET_BYTES)}"
    return plaintext, plaintext[: len(SECRET_PREFIX) + 8], _hash(plaintext)


def _hash(plaintext: str) -> str:
    """The same format the seed writes, so one column has one shape.

    A plain SHA-256 because the point being demonstrated is that the plaintext
    is *not stored*. Real issuance should use a slow KDF; the column is sized
    for one.
    """
    return f"sha256${hashlib.sha256(plaintext.encode()).hexdigest()}"


def credential_state(row) -> str:
    """What a credential *is*, from its own dates rather than its column.

    `status` is a stored word and the dates are the facts; a key whose
    `expires_at` passed last Tuesday is expired whatever the column says. So
    the state is derived, and the column is not read.
    """
    if row.revoked_at is not None:
        return "REVOKED"
    if row.expires_at is not None and row.expires_at <= now():
        return "EXPIRED"
    return "ACTIVE"


def summarise_credential(row) -> dict[str, Any]:
    """One credential. Never the secret — there is nothing to send."""
    return {
        "id": str(row.id),
        "label": row.label,
        # The only part of the key that is ever shown again: enough to tell two
        # apart in a log line, not enough to use.
        "prefix": row.prefix,
        "state": credential_state(row),
        "created_at": iso(row.created_at),
        "expires_at": iso(row.expires_at),
        "last_used_at": iso(row.last_used_at),
        "revoked_at": iso(row.revoked_at),
        "rotated_from_id": str(row.rotated_from_id) if row.rotated_from_id else None,
    }
