"""The node kinds a graph is drawn from: triggers, flow steps, their ports."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.services.automation.graph.shape import MAX_NODES

#: How long a delay node may hold a record: thirty days.
MAX_WAIT_MINUTES = 60 * 24 * 30


TRIGGERS: dict[str, dict[str, Any]] = {
    "RECORD_CREATED": {
        "label": "Record created",
        "description": "Runs once for every new record in the dataset.",
    },
    "RECORD_UPDATED": {
        "label": "Record updated",
        "description": "Runs whenever a record in the dataset is edited.",
    },
    "FIELD_CHANGED": {
        "label": "Field changed",
        "description": "Runs when one field changes — optionally only to one value.",
        "needs": ["field"],
    },
    "SCHEDULE": {
        "label": "On a schedule",
        "description": "Runs on a cron schedule over the records its first condition selects.",
        "needs": ["schedule"],
    },
    "WEBHOOK": {
        "label": "Webhook called",
        "description": "Runs when another system POSTs a record id to the workflow's own address.",
    },
    "FORM_SUBMITTED": {
        "label": "Form submitted",
        "description": "Runs when an intake form creates a record in the dataset.",
    },
}


#: Actions that change where the walk goes rather than doing something to the
#: record. Executed by the engine itself; the rest are `workflows.ACTIONS`.
FLOW: dict[str, dict[str, Any]] = {
    "WAIT": {
        "label": "Wait",
        "description": "Pause this record for a while, then carry on.",
        "needs": ["minutes"],
        "ports": ["out"],
    },
    "APPROVAL": {
        "label": "Request approval",
        "description": "Ask somebody to approve; carry on down Approved or Rejected.",
        "needs": [],
        "ports": ["approved", "rejected"],
    },
}


PORTS = {
    "trigger": ("out",),
    "condition": ("out",),
    "branch": ("true", "false"),
}


def _ports_for(node: dict[str, Any]) -> tuple[str, ...]:
    kind = node.get("type")
    if kind == "action":
        flow = FLOW.get(str((node.get("data") or {}).get("kind") or "").upper())
        return tuple(flow["ports"]) if flow else ("out",)
    return PORTS.get(str(kind), ())


APPROVAL_KIND = "automation"


def catalogue_extras(session) -> dict[str, Any]:
    """What the canvas palette offers beyond the form editor's catalogue."""
    from src.models.forms import IntakeForm

    try:
        forms = session.execute(
            select(IntakeForm.slug, IntakeForm.name, IntakeForm.target)
            .where(IntakeForm.deleted_at.is_(None)).order_by(IntakeForm.name)
        ).all()
    except Exception:  # noqa: BLE001 - forms are another feature; absent is fine
        forms = []
    return {
        "triggers": [{"event": key, **value, "needs": value.get("needs", [])} for key, value in TRIGGERS.items()],
        "flow": [{"kind": key, "label": value["label"], "description": value["description"],
                  "needs": value["needs"], "ports": value["ports"]} for key, value in FLOW.items()],
        "forms": [{"slug": slug, "name": name, "target": target} for slug, name, target in forms],
        "approvals": True,
        "limits_graph": {"max_nodes": MAX_NODES, "max_wait_minutes": MAX_WAIT_MINUTES},
    }
