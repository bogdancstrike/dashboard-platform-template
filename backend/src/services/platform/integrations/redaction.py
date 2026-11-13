"""Integration settings: what is missing, what is redacted, and a summary."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Select, select

from src.core import vocabulary
from src.core.clock import iso
from src.core.query import Field, FieldSet

#: Reading which systems are connected. Its own permission because the
#: configuration names hosts and secret references — reconnaissance, if not
#: secrets.
PERMISSION = "integrations.manage"


#: Settings whose *name* says they hold something sensitive.
#:
#: Matched on the key rather than the value: a token is a string like any
#: other, and guessing by shape would redact a base URL that happened to look
#: like one while missing a short key that did not.
_SECRETISH = re.compile(r"(secret|token|password|key|credential)", re.IGNORECASE)


#: What a redacted value reads as. The same one the settings screen uses, so a
#: reader who has seen one recognises the other.
REDACTED = "••••••••"


#: A setting name has to be a name, not a sentence.
_SETTING = re.compile(r"^[a-z][a-z0-9_]{1,63}$")


def _fields() -> FieldSet:
    """Built lazily so importing this module does not pull the models at boot."""
    from src.models.platform import Integration

    return FieldSet(
        Field("name", Integration.name, searchable=True),
        Field("key", Integration.key, searchable=True),
        Field("provider", Integration.provider, kind="enum", facet=True, searchable=True),
        Field("category", Integration.category, kind="enum", facet=True,
              choices=vocabulary.INTEGRATION_CATEGORY),
        Field("status", Integration.status, kind="enum", facet=True,
              choices=vocabulary.INTEGRATION_STATUS),
        Field("enabled", Integration.enabled, kind="bool", facet=True),
        Field("last_connected_at", Integration.last_connected_at, kind="datetime",
              label="Last connected"),
        Field("description", Integration.description, searchable=True),
        Field("id", Integration.id, kind="uuid", label="Integration ID"),
    )


DEFAULT_COLUMNS = ("name", "category", "state", "last_connected_at")


def _statement() -> Select:
    from src.models.platform import Integration

    return select(Integration).where(Integration.deleted_at.is_(None))


def missing_settings(row) -> list[str]:
    """The required settings this integration has not been given.

    Empty and blank both count as missing: a `secret_ref` set to "" is a
    setting somebody started filling in and abandoned, and treating it as
    present is how a check passes for something that cannot possibly work.
    """
    configuration = row.configuration or {}
    return [
        name
        for name in (row.required_settings or [])
        if not str(configuration.get(name, "") or "").strip()
    ]


def state(row) -> str:
    """What this integration *is*, rather than what its column says.

    `NOT_CONFIGURED` is a fact about the settings and takes precedence over
    everything: an integration missing its token is not "connected" whatever
    happened last week. Otherwise the stored status stands, because that is
    genuinely a record of the last attempt.
    """
    if missing_settings(row):
        return "NOT_CONFIGURED"
    if row.status not in vocabulary.INTEGRATION_STATUS:
        return "DISCONNECTED"
    # The column may still say NOT_CONFIGURED on an older row whose settings
    # have since been filled in. It has not been tried since, which is exactly
    # what DISCONNECTED means.
    return "DISCONNECTED" if row.status == "NOT_CONFIGURED" else row.status


def _visible_configuration(row) -> dict[str, Any]:
    """The configuration, with anything named like a secret redacted.

    Redacted rather than omitted, so a reader can see that a value *is* set —
    "not shown to you" and "not configured" are different answers and this
    screen turns on the difference.
    """
    return {
        name: REDACTED if _SECRETISH.search(name) and value else value
        for name, value in (row.configuration or {}).items()
    }


def summarise(row) -> dict[str, Any]:
    """One integration, as a table row."""
    absent = missing_settings(row)
    return {
        "id": str(row.id),
        "key": row.key,
        "name": row.name,
        "provider": row.provider,
        "category": row.category,
        "description": row.description,
        # Intent and outcome, kept apart: "switched on and failing" is a state
        # that exists and is the row somebody needs to see.
        "enabled": bool(row.enabled),
        "state": state(row),
        "configured": not absent,
        "missing_settings": absent,
        "required_settings": list(row.required_settings or []),
        "last_connected_at": iso(row.last_connected_at),
        "last_error": row.last_error,
        "last_error_at": iso(row.last_error_at),
        "icon": row.icon,
        "docs_url": row.docs_url,
    }
