"""Checking an integration's connection."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.clock import iso, now
from src.services.platform.integrations.listing_view import _integration
from src.services.platform.integrations.redaction import (
    PERMISSION,
    missing_settings,
    summarise,
)


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
