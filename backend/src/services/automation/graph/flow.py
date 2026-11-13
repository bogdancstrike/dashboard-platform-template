"""Flow steps that are not actions: branches, delays and approval requests."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from src.core.clock import iso, now
from src.core.pagination import parse_uuid
from src.models.automation_graphs import AutomationWait
from src.services.automation.graph.kinds import APPROVAL_KIND
from src.services.automation.graph.walk import Walk
from src.services.automation.workflows.actions import _text
from src.services.decisions import approvals


def _flow(session, walk: Walk, node, kind: str, data: dict[str, Any], matches: list) -> dict[str, list]:
    """A delay or an approval: in a dry run, the path it would take; for real, a park."""
    if walk.dry_run:
        for match in matches:
            detail = (f"would wait {data.get('minutes')} min" if kind == "WAIT"
                      else "would ask for approval")
            walk.visit(node["id"], match, "waiting", detail)
            walk.count(node["id"], "ok")
        # The rehearsal follows the hopeful path, so the reader sees the rest.
        return {"out": matches} if kind == "WAIT" else {"approved": matches}

    for match in matches:
        wait = AutomationWait(
            rule_id=walk.rule.id,
            run_id=walk.run.id if walk.run is not None else None,
            version=walk.version,
            node_id=node["id"],
            resource_type=walk.resource.key,
            record_id=match.id,
            record_label=match.label[:240],
            kind="DELAY" if kind == "WAIT" else "APPROVAL",
            status="PENDING",
        )
        if kind == "WAIT":
            minutes = int(data.get("minutes") or 1)
            wait.due_at = now() + timedelta(minutes=minutes)
            detail = f"waiting until {iso(wait.due_at)}"
        else:
            detail = _ask(session, walk, data, match, wait)
        session.add(wait)
        walk.parked += 1
        walk.count(node["id"], "waiting")
        walk.visit(node["id"], match, "waiting", detail)
        walk.records[match.id]["actions"].append(
            {"kind": kind, "ok": True, "detail": detail, "node_id": node["id"]}
        )
    session.flush()
    return {}


def _ask(session, walk: Walk, data: dict[str, Any], match, wait: AutomationWait) -> str:
    owner = walk.rule.owner
    row = approvals.submit(
        session,
        kind=APPROVAL_KIND,
        requester_id=walk.rule.owner_id,
        requester_label=owner.full_name if owner else walk.rule.name,
        title=_text(str(data.get("title") or "{rule}: approve {record}"), match, walk.rule),
        summary=_text(str(data.get("body") or ""), match, walk.rule),
        subject_type=walk.resource.key,
        subject_id=match.id,
        subject_label=match.label,
        link=match.path,
        payload={"rule_id": str(walk.rule.id), "rule": walk.rule.name},
        assignee_id=parse_uuid(data["assignee_id"], field="assignee_id") if data.get("assignee_id") else None,
    )
    wait.approval_id = str(row.id)
    return f"asked {row.reference}"
