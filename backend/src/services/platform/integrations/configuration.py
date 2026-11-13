"""Configuring and enabling an integration."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.errors import ValidationError
from src.services.platform.integrations.listing_view import _integration
from src.services.platform.integrations.redaction import (
    _SETTING,
    PERMISSION,
    REDACTED,
    _visible_configuration,
    missing_settings,
    summarise,
)


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
