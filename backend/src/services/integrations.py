"""Connected systems (§26): what this platform talks to, and whether it works.

Twelve providers, their settings, and the outcome of the last attempt to reach
each one. Five decisions, and the first two are the ones that keep this screen
honest.

**"Not configured" is derived, never trusted.** Whether an integration has what
it needs is a fact about its settings: every name in `required_settings` present
in `configuration` and not empty. The stored `status` used to be drawn
independently of the configuration, so three of twelve rows said
`NOT_CONFIGURED` while holding every setting they required — contradicting the
one fact this page exists to establish. `state()` computes it, and the column
cannot lie because nothing reads it for that purpose.

**A check verifies the configuration and says so — it does not claim to have
reached the provider.** Nothing in this template holds real Stripe credentials,
and a button that reported "Connected to Stripe" when no packet left the process
would be the worst possible lie on a screen whose whole job is to say whether
things work. So the answer is explicit about what was and was not tried, and
`last_error` records a failed *check* as a check.

**`enabled` is intent; `status` is outcome.** Which makes "switched on and
failing" a state that exists — and it is the row an operator most needs to see,
so it is not smoothed away into a single word.

**A secret is a reference, never a value.** `configuration` holds
`secret_ref: "STRIPE_API_TOKEN"`, a name that resolves in the deployment's own
secret store. Anything that looks like a value is redacted on the way out, since
an integrations screen that renders a token puts it in a screenshot.

**Nothing here is created or deleted.** The twelve providers are what the
platform knows how to talk to — a list that comes with the code, not one an
operator extends by typing a name. What they *can* do is configure, enable, and
check.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import Select, func, select

from src.core import audit, vocabulary
from src.core.clock import iso, now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import envelope, parse_page, parse_uuid
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for

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


def catalogue(session, *, principal) -> dict[str, Any]:
    """The categories and states, with a count against each."""
    principal.require(PERMISSION)
    from src.models.platform import Integration

    rows = session.scalars(_statement()).all()
    by_state: dict[str, int] = {}
    for row in rows:
        key = state(row)
        by_state[key] = by_state.get(key, 0) + 1

    counted = dict(
        session.execute(
            select(Integration.category, func.count())
            .where(Integration.deleted_at.is_(None))
            .group_by(Integration.category)
        ).all()
    )
    return {
        "fields": _fields().describe(),
        "default_columns": list(DEFAULT_COLUMNS),
        "categories": [
            {"key": category, "count": int(counted.get(category, 0))}
            for category in vocabulary.INTEGRATION_CATEGORY
        ],
        # Counted on the *derived* state, so the numbers agree with the rows.
        "states": [
            {"key": item, "count": by_state.get(item, 0)}
            for item in vocabulary.INTEGRATION_STATUS
        ],
        "total": len(rows),
        # The rows an operator should look at first: switched on and not
        # working. Surfaced as a number because it is the reason to open this
        # page at all.
        "needing_attention": sum(
            1 for row in rows if row.enabled and state(row) != "CONNECTED"
        ),
        "redacted": REDACTED,
    }


def listing(session, args, *, principal) -> dict[str, Any]:
    """Every integration, filtered and faceted in PostgreSQL (§71)."""
    principal.require(PERMISSION)
    fields = _fields()
    page = parse_page(args, default_sort="name", default_order="asc")

    statement = apply_filters(_statement(), args, fields)
    total = count_of(session, statement)
    facets = facets_for(session, statement, fields)
    statement = apply_sort(statement, page, fields, default="name")
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).all()

    return envelope(
        [summarise(row) for row in rows],
        total,
        page,
        fields=fields.describe(),
        facets=facets,
        columns=list(DEFAULT_COLUMNS),
    )


def _integration(session, integration_id: str):
    from src.models.platform import Integration

    row = session.get(Integration, parse_uuid(integration_id, field="id"))
    if row is None or row.deleted_at is not None:
        raise NotFoundError("That integration does not exist.")
    return row


def entry(session, integration_id: str, *, principal) -> dict[str, Any]:
    """One integration, with its configuration."""
    principal.require(PERMISSION)
    row = _integration(session, integration_id)
    return {
        **summarise(row),
        "configuration": _visible_configuration(row),
        # Which keys came back redacted, so the page can render them as "set,
        # not shown" rather than as a value somebody might try to edit.
        "redacted_settings": sorted(
            name
            for name, value in (row.configuration or {}).items()
            if _SECRETISH.search(name) and value
        ),
    }


def configure(
    session, integration_id: str, payload: dict[str, Any], *, principal
) -> dict[str, Any]:
    """Set an integration's settings.

    Merged rather than replaced, and a value equal to the redaction is skipped:
    the page sends back what it was given, and a form that had never shown the
    real token would otherwise overwrite it with bullet characters. The same
    rule the settings screen needs, for the same reason.
    """
    principal.require(PERMISSION)
    row = _integration(session, integration_id)

    incoming = payload.get("configuration")
    if not isinstance(incoming, dict):
        raise ValidationError("configuration must be an object of settings.")

    bad = [name for name in incoming if not _SETTING.match(str(name))]
    if bad:
        raise ValidationError(
            f"{', '.join(sorted(bad))} " + ("is not a setting name." if len(bad) == 1 else "are not setting names."),
            details={"invalid": sorted(bad)},
        )

    before = missing_settings(row)
    merged = dict(row.configuration or {})
    for name, value in incoming.items():
        # The redaction coming back means "leave it alone", not "set it to
        # bullets" — otherwise showing a masked field once destroys it.
        if isinstance(value, str) and value == REDACTED:
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            merged.pop(name, None)
        else:
            merged[name] = value
    row.configuration = merged

    after = missing_settings(row)
    audit.record(
        session,
        action="UPDATE",
        resource_type="integration",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        # The *names* only. An audit row carrying the values would be the
        # secret store nobody meant to build.
        before={"missing": before},
        after={"missing": after, "settings": sorted(merged)},
        message=(
            f"configured {row.name}"
            + (f" — still missing {', '.join(after)}" if after else " — nothing missing now")
        ),
    )
    session.flush()
    return {
        **summarise(row),
        "configuration": _visible_configuration(row),
    }


def set_enabled(
    session, integration_id: str, payload: dict[str, Any], *, principal
) -> dict[str, Any]:
    """Turn an integration on or off.

    Refused while it is missing settings: switching on something that cannot
    possibly work produces a failure with no cause, and an operator then spends
    an afternoon on a token nobody entered. The refusal names the settings.
    """
    principal.require(PERMISSION)
    row = _integration(session, integration_id)
    wanted = bool(payload.get("enabled"))

    if wanted:
        absent = missing_settings(row)
        if absent:
            raise ValidationError(
                f"{row.name} still needs {', '.join(absent)}. "
                "Switching it on now would fail with no cause to find.",
                details={"missing_settings": absent},
            )

    before = bool(row.enabled)
    row.enabled = wanted
    if not wanted:
        # Turning it off is not a connection outcome, so the status becomes
        # "we are not talking to it" rather than keeping a stale CONNECTED.
        row.status = "DISCONNECTED"

    audit.record(
        session,
        action="UPDATE",
        resource_type="integration",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        before={"enabled": before},
        after={"enabled": wanted},
        message=f"{'enabled' if wanted else 'disabled'} {row.name}",
    )
    session.flush()
    return summarise(row)


def check(session, integration_id: str, *, principal) -> dict[str, Any]:
    """Verify the configuration is complete, and say exactly what was checked.

    Deliberately *not* a connection attempt. Nothing in this template holds
    real provider credentials, and a button reporting "Connected to Stripe"
    when no packet left the process would be the worst possible lie on a screen
    whose whole job is to say whether things work. So the answer carries
    `reached_provider: false` and a sentence saying what it did — and a failed
    check is recorded as a failed *check*, in the same `last_error` an operator
    reads, worded so nobody mistakes it for the provider's own message.

    Where to make it real: replace the body of this function with the
    provider's own ping, keep the same answer shape, and set
    `reached_provider` honestly.
    """
    principal.require(PERMISSION)
    row = _integration(session, integration_id)

    absent = missing_settings(row)
    moment = now()

    if absent:
        row.status = "NOT_CONFIGURED"
        row.last_error = (
            f"Configuration check: {', '.join(absent)} "
            + ("is" if len(absent) == 1 else "are")
            + " not set."
        )
        row.last_error_at = moment
    else:
        # The settings are all there. That is what was established — not that
        # the provider answered.
        row.status = "DISCONNECTED" if not row.enabled else row.status
        row.last_error = None
        row.last_error_at = None

    audit.record(
        session,
        action="UPDATE",
        resource_type="integration",
        resource_id=row.id,
        resource_label=row.name,
        principal=principal,
        after={"missing": absent},
        message=(
            f"checked {row.name}'s configuration — "
            + ("complete" if not absent else f"missing {', '.join(absent)}")
        ),
    )
    session.flush()
    return {
        **summarise(row),
        "configured": not absent,
        "missing_settings": absent,
        # Said plainly, in the payload, so no caller can mistake this for a
        # live handshake.
        "reached_provider": False,
        "checked_at": iso(moment),
        "note": (
            "Every required setting is present. This does not contact "
            f"{row.provider} — replace `services/integrations.check` with the "
            "provider's own ping to make it a real connection test."
            if not absent
            else f"{', '.join(absent)} must be set before {row.provider} can be reached."
        ),
    }
