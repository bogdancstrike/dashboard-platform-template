"""API clients and their credentials (§25): machines that call the platform.

A client is a *consumer*; a credential is one key it may call with. One client
can hold several — which is the whole reason rotation is possible without an
outage.

Five decisions, and the first two are the ones that matter.

**A secret is shown once, at creation, and never again.** Only `secret_hash`
is stored, so this is not a policy but a property: there is nothing to show a
second time. The plaintext appears in exactly one response and is never
reachable again, which is why the answer says so in the same breath.

**A client cannot be scoped beyond what its creator holds.** Scopes come from
the permission catalogue, so granting one to a machine is granting a
permission — and a client scoped `users.impersonate` is a machine that can
become anybody. Without this rule `api.manage` would be a path to every
permission in the catalogue, the same way `users.manage` would have been on
`/admin/groups`. Only ADMINISTRATOR holds `api.manage` today; the rule is here
so that stays true if a narrower role ever gets it.

**Rotation issues a new credential rather than replacing one.** `rotated_from`
records the chain, and the old key keeps working until its own expiry — a
rotation that killed the previous secret the instant a new one was minted is
not a rotation, it is an outage with extra steps. The old one is given a short
expiry rather than left forever, so "rotate" still means something.

**A revoked credential is kept.** Revocation is what somebody does when a key
has leaked, and the question afterwards is always *when, and by whom* — a row
that vanished answers neither. It is refused for a second time rather than
silently accepted, because "revoke" twice suggests the first did not take.

**The two windows of numbers are labelled, not merged.** `requests_total` and
`error_rate` are lifetime counters the gateway maintains; `api_request_logs` is
a recent window it keeps. Three point seven million against twelve logged rows
is not a contradiction, it is two different questions — but a screen that put
them side by side unlabelled would read as one.
"""

from __future__ import annotations

import hashlib
import re
import secrets
from typing import Any

from sqlalchemy import Select, func, select

from src.core import audit, vocabulary
from src.core.auth import ALL_PERMISSIONS, PERMISSION_LABELS
from src.core.clock import iso, now
from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for

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


def summarise(row, *, credentials: int = 0, live: int = 0) -> dict[str, Any]:
    """One client, as a table row."""
    return {
        "id": str(row.id),
        "name": row.name,
        "client_id": row.client_id,
        "description": row.description,
        "status": row.status,
        "scopes": sorted(row.scopes or []),
        "rate_limit_per_minute": int(row.rate_limit_per_minute or 0),
        "quota_per_day": int(row.quota_per_day or 0),
        # Lifetime counters the gateway maintains. Not comparable with the
        # request log, which is a recent window — see the module docstring.
        "requests_today": int(row.requests_today or 0),
        "requests_total": int(row.requests_total or 0),
        "error_rate": float(row.error_rate or 0),
        "last_used_at": iso(row.last_used_at),
        "allowed_ips": list(row.allowed_ips or []),
        "credential_count": credentials,
        "live_credentials": live,
        "created_at": iso(row.created_at),
    }


def catalogue(session, *, principal) -> dict[str, Any]:
    """The vocabulary the client editor is built from."""
    principal.require(PERMISSION)

    return {
        "fields": _fields().describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "statuses": list(vocabulary.API_CLIENT_STATUS),
        # Only what the caller may actually grant. Offering the whole catalogue
        # and refusing half of it on save would be a form that produces an
        # error on purpose.
        "scopes": [
            {"code": code, "label": PERMISSION_LABELS.get(code, code)}
            for code in ALL_PERMISSIONS
            if principal.can(code)
        ],
        "withheld_scopes": [code for code in ALL_PERMISSIONS if not principal.can(code)],
        "rotation_grace_days": ROTATION_GRACE_DAYS,
        "total": count_of(session, _statement()),
    }


def _counts(session, ids: list[Any]) -> tuple[dict[Any, int], dict[Any, int]]:
    """Credentials per client, and how many of them still work."""
    from src.models.platform import ApiCredential

    if not ids:
        return {}, {}
    rows = session.scalars(
        select(ApiCredential).where(ApiCredential.api_client_id.in_(ids))
    ).all()
    total: dict[Any, int] = {}
    live: dict[Any, int] = {}
    for row in rows:
        total[row.api_client_id] = total.get(row.api_client_id, 0) + 1
        if credential_state(row) == "ACTIVE":
            live[row.api_client_id] = live.get(row.api_client_id, 0) + 1
    return total, live


def listing(session, args, *, principal) -> dict[str, Any]:
    """One page of clients, filtered and faceted in PostgreSQL (§71)."""
    principal.require(PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="name", default_order="asc")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="name")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    counted, live = _counts(session, [row.id for row in rows])
    return envelope(
        [
            summarise(row, credentials=counted.get(row.id, 0), live=live.get(row.id, 0))
            for row in rows
        ],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
    )


def _client(session, client_id: str):
    from src.models.platform import ApiClient

    row = session.get(ApiClient, parse_uuid(client_id, field="id"))
    if row is None or row.deleted_at is not None:
        raise NotFoundError("That API client does not exist.")
    return row


def entry(session, client_id: str, *, principal) -> dict[str, Any]:
    """One client: its credentials, and the requests it has recently made."""
    principal.require(PERMISSION)
    from src.models.platform import ApiCredential, ApiRequestLog

    row = _client(session, client_id)
    credentials = session.scalars(
        select(ApiCredential)
        .where(ApiCredential.api_client_id == row.id)
        .order_by(ApiCredential.created_at.desc())
    ).all()
    requests = session.scalars(
        select(ApiRequestLog)
        .where(ApiRequestLog.api_client_id == row.id)
        .order_by(ApiRequestLog.requested_at.desc())
        .limit(MAX_REQUESTS)
    ).all()

    counted, live = _counts(session, [row.id])
    return {
        **summarise(row, credentials=counted.get(row.id, 0), live=live.get(row.id, 0)),
        "credentials": [summarise_credential(item) for item in credentials],
        "recent_requests": [
            {
                "id": str(item.id),
                "requested_at": iso(item.requested_at),
                "method": item.method,
                "path": item.path,
                "status_code": item.status_code,
                "duration_ms": float(item.duration_ms or 0),
                "ip_address": item.ip_address,
                "bytes_out": int(item.bytes_out or 0),
            }
            for item in requests
        ],
        # Said explicitly, because the number beside it is a *lifetime* total
        # and these are a window. Two questions, and a screen that put them
        # together unlabelled would read as one answer.
        "recent_window": len(requests),
        "recent_failures": sum(1 for item in requests if item.status_code >= 400),
    }


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Register a client, and mint its first credential.

    The response carries the plaintext secret. It is the only time it exists
    outside the caller's memory: only the hash is stored, so there is nothing
    to show a second time — which the answer says in the same breath rather
    than leaving somebody to discover it.
    """
    principal.require(PERMISSION)
    from src.models.platform import ApiClient, ApiCredential

    name = _checked(payload.get("name"), _NAME, "client name")
    scopes = _checked_scopes(payload.get("scopes"), principal=principal)

    client_id = f"nuc-{secrets.token_hex(8)}"
    row = ApiClient(
        name=name,
        client_id=client_id,
        description=str(payload.get("description") or "").strip() or None,
        status="ACTIVE",
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        scopes=scopes,
        rate_limit_per_minute=_bounded(payload.get("rate_limit_per_minute"), 600, 1, 100_000),
        quota_per_day=_bounded(payload.get("quota_per_day"), 100_000, 1, 100_000_000),
        allowed_ips=[str(item).strip() for item in (payload.get("allowed_ips") or []) if str(item).strip()],
        requests_today=0,
        requests_total=0,
        error_rate=0,
    )
    session.add(row)
    session.flush()

    plaintext, prefix, hashed = _mint()
    credential = ApiCredential(
        api_client_id=row.id,
        label=str(payload.get("credential_label") or "Initial key").strip()[:120],
        prefix=prefix,
        secret_hash=hashed,
        status="ACTIVE",
        created_by_id=principal.user_id,
    )
    session.add(credential)
    session.flush()

    audit.record(
        session,
        action="CREATE",
        resource_type="api_client",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        after={"client_id": row.client_id, "scopes": scopes},
        # The scopes, named: "created an API client" without them is an audit
        # entry that does not record what was granted.
        message=f"registered {row.name} with " + (", ".join(scopes) if scopes else "no scopes"),
    )
    return {
        **summarise(row, credentials=1, live=1),
        "credential": summarise_credential(credential),
        # Once. There is no endpoint that can return this again.
        "secret": plaintext,
        "secret_shown_once": True,
    }


def _bounded(value: Any, default: int, low: int, high: int) -> int:
    if value is None:
        return default
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ValidationError("That must be a whole number.") from None
    if not low <= number <= high:
        raise ValidationError(
            f"That must be between {low} and {high}.",
            details={"minimum": low, "maximum": high, "value": number},
        )
    return number


def update(session, client_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Edit a client: its name, its scopes, its limits, its addresses."""
    principal.require(PERMISSION)
    row = _client(session, client_id)

    before = {"name": row.name, "scopes": sorted(row.scopes or []), "status": row.status}
    if "name" in payload:
        row.name = _checked(payload.get("name"), _NAME, "client name")
    if "description" in payload:
        row.description = str(payload.get("description") or "").strip() or None
    if "scopes" in payload:
        row.scopes = _checked_scopes(payload.get("scopes"), principal=principal)
    if "status" in payload:
        wanted = str(payload.get("status") or "").strip().upper()
        if wanted not in vocabulary.API_CLIENT_STATUS:
            raise ValidationError(
                f"{wanted!r} is not a client status.",
                details={"allowed": list(vocabulary.API_CLIENT_STATUS)},
            )
        row.status = wanted
    if "rate_limit_per_minute" in payload:
        row.rate_limit_per_minute = _bounded(
            payload.get("rate_limit_per_minute"), row.rate_limit_per_minute, 1, 100_000
        )
    if "quota_per_day" in payload:
        row.quota_per_day = _bounded(
            payload.get("quota_per_day"), row.quota_per_day, 1, 100_000_000
        )
    if "allowed_ips" in payload:
        row.allowed_ips = [
            str(item).strip() for item in (payload.get("allowed_ips") or []) if str(item).strip()
        ]

    after = {"name": row.name, "scopes": sorted(row.scopes or []), "status": row.status}
    audit.record(
        session,
        action="UPDATE",
        resource_type="api_client",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before=before,
        after=after,
        message=_change_sentence(row.name, before, after),
    )
    session.flush()
    counted, live = _counts(session, [row.id])
    return summarise(row, credentials=counted.get(row.id, 0), live=live.get(row.id, 0))


def _change_sentence(name: str, before: dict[str, Any], after: dict[str, Any]) -> str:
    """What moved, in words.

    "updated an API client" is the audit message nobody can act on; a scope
    that was added is the thing a security review is looking for.
    """
    added = sorted(set(after["scopes"]) - set(before["scopes"]))
    removed = sorted(set(before["scopes"]) - set(after["scopes"]))
    parts = []
    if added:
        parts.append(f"+{', '.join(added)}")
    if removed:
        parts.append(f"-{', '.join(removed)}")
    if before["status"] != after["status"]:
        parts.append(f"{before['status'].lower()} → {after['status'].lower()}")
    return f"edited {name}" + (f" ({'; '.join(parts)})" if parts else "")


def rotate(session, client_id: str, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Mint a new credential, and give the old one a deadline.

    Not a replacement: the previous key keeps working for
    `ROTATION_GRACE_DAYS`, because a rotation that killed it the instant a new
    one was minted is an outage with extra steps — every caller holding the old
    secret fails until somebody redeploys them. And not left forever either, or
    "rotate" would just mean "mint a second key": the old one is given an
    expiry, so the deadline is real and visible.

    `rotated_from` records the chain, which is what makes "how old is the key
    this service is using" a question with an answer.
    """
    principal.require(PERMISSION)
    from datetime import timedelta

    from src.models.platform import ApiCredential

    row = _client(session, client_id)
    replacing_id = payload.get("credential_id")
    replacing = None
    if replacing_id:
        replacing = session.get(ApiCredential, parse_uuid(str(replacing_id), field="credential_id"))
        if replacing is None or replacing.api_client_id != row.id:
            raise NotFoundError("That credential does not belong to this client.")
        if credential_state(replacing) == "REVOKED":
            raise ConflictError(
                f"{replacing.prefix}… was revoked, so there is nothing to rotate. "
                "Add a new credential instead.",
                details={"state": "REVOKED"},
            )

    plaintext, prefix, hashed = _mint()
    credential = ApiCredential(
        api_client_id=row.id,
        label=str(payload.get("label") or f"Rotated {iso(now())[:10]}").strip()[:120],
        prefix=prefix,
        secret_hash=hashed,
        status="ACTIVE",
        created_by_id=principal.user_id,
        rotated_from_id=replacing.id if replacing else None,
    )
    session.add(credential)

    deadline = None
    if replacing is not None:
        deadline = now() + timedelta(days=ROTATION_GRACE_DAYS)
        # Never pushed *out*: if the old key already expires sooner than the
        # grace period, rotating must not extend its life.
        if replacing.expires_at is None or replacing.expires_at > deadline:
            replacing.expires_at = deadline

    session.flush()
    audit.record(
        session,
        action="CREATE",
        resource_type="api_credential",
        resource_id=credential.id,
        resource_label=f"{row.name}: {credential.label}",
        principal=principal,
        after={"prefix": credential.prefix, "rotated_from": replacing.prefix if replacing else None},
        message=(
            f"rotated {row.name}"
            + (f" — {replacing.prefix}… expires {iso(deadline)[:10]}" if replacing else "")
        ),
    )
    return {
        "credential": summarise_credential(credential),
        "secret": plaintext,
        "secret_shown_once": True,
        "replaced": summarise_credential(replacing) if replacing else None,
        "grace_days": ROTATION_GRACE_DAYS if replacing else None,
    }


def revoke(session, credential_id: str, *, principal) -> dict[str, Any]:
    """Kill a credential now, and keep the row.

    Revocation is what somebody does when a key has leaked, and the question
    afterwards is always *when, and by whom* — a row that vanished answers
    neither. Refused a second time rather than silently accepted, because
    "revoke" twice suggests the first one did not take.
    """
    principal.require(PERMISSION)
    from src.models.platform import ApiCredential

    row = session.get(ApiCredential, parse_uuid(credential_id, field="id"))
    if row is None:
        raise NotFoundError("That credential does not exist.")
    if row.revoked_at is not None:
        raise ConflictError(
            f"{row.prefix}… was already revoked {iso(row.revoked_at)[:10]}.",
            details={"revoked_at": iso(row.revoked_at)},
        )

    moment = now()
    row.revoked_at = moment
    row.revoked_by_id = principal.user_id
    row.status = "REVOKED"

    audit.record(
        session,
        action="DELETE",
        resource_type="api_credential",
        resource_id=row.id,
        resource_label=f"{row.prefix}…",
        principal=principal,
        before={"state": "ACTIVE"},
        after={"state": "REVOKED"},
        message=f"revoked {row.prefix}…",
    )
    session.flush()
    return summarise_credential(row)


def remove(session, client_id: str, *, principal) -> dict[str, Any]:
    """Retire a client, revoking every credential it holds.

    The revocation is the point. A soft-deleted client whose credentials stayed
    live would be a consumer nothing lists any more, still able to call — which
    is the worst of both, and exactly the shape of bug a retired *group* had.
    """
    principal.require(PERMISSION)
    from src.models.platform import ApiCredential

    row = _client(session, client_id)
    moment = now()
    live = [
        item
        for item in session.scalars(
            select(ApiCredential).where(ApiCredential.api_client_id == row.id)
        ).all()
        if credential_state(item) == "ACTIVE"
    ]
    for item in live:
        item.revoked_at = moment
        item.revoked_by_id = principal.user_id
        item.status = "REVOKED"

    label = row.name
    row.deleted_at = moment
    row.status = "REVOKED"

    audit.record(
        session,
        action="DELETE",
        resource_type="api_client",
        resource_id=row.id,
        resource_label=label,
        principal=principal,
        before={"live_credentials": len(live)},
        message=f"retired {label}, revoking {len(live)} live "
        + ("credential" if len(live) == 1 else "credentials"),
    )
    session.flush()
    return {
        "deleted": True,
        "id": str(row.id),
        "name": label,
        "credentials_revoked": len(live),
    }
