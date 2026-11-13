"""Page templates, and the blocks a meeting's notes start from."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import uuid4

from src.services.collaboration.docs.blocks import VIEW


def _b(kind: str, **fields: Any) -> dict[str, Any]:
    return {"id": f"t{uuid4().hex[:8]}", "kind": kind, **fields}


def _template_blocks(key: str) -> list[dict[str, Any]]:
    if key == "meeting":
        return [
            _b("callout", tone="info", text="Date, attendees and agenda go here."),
            _b("heading", level=2, text="Agenda"),
            _b("list", ordered=True, items=["", ""]),
            _b("heading", level=2, text="Notes"),
            _b("text", text=""),
            _b("heading", level=2, text="Decisions"),
            _b("list", ordered=False, items=[""]),
            _b("heading", level=2, text="Action items"),
            _b("action", text="", assignee_id=None, due_date=None, task_id=None),
        ]
    if key == "runbook":
        return [
            _b("callout", tone="warning", text="When to use this runbook, and who owns it."),
            _b("heading", level=2, text="Symptoms"),
            _b("list", ordered=False, items=["", ""]),
            _b("heading", level=2, text="Diagnosis"),
            _b("checklist", items=[{"text": "Check the service health page", "done": False},
                                   {"text": "Read the last hour of error logs", "done": False}]),
            _b("heading", level=2, text="Fix"),
            _b("code", language="bash", text="# commands, one per line"),
            _b("heading", level=2, text="Escalation"),
            _b("text", text="Who to call if the steps above did not work."),
        ]
    if key == "spec":
        return [
            _b("heading", level=2, text="Problem"),
            _b("text", text="What is wrong today, for whom, and how we know."),
            _b("heading", level=2, text="Goals and non-goals"),
            _b("list", ordered=False, items=["Goal:", "Non-goal:"]),
            _b("heading", level=2, text="Proposal"),
            _b("text", text=""),
            _b("heading", level=2, text="Open questions"),
            _b("checklist", items=[{"text": "", "done": False}]),
            _b("heading", level=2, text="Rollout"),
            _b("table", header=True, rows=[["Step", "Owner", "When"], ["", "", ""]]),
        ]
    if key == "retro":
        return [
            _b("heading", level=2, text="What went well"),
            _b("list", ordered=False, items=[""]),
            _b("heading", level=2, text="What did not"),
            _b("list", ordered=False, items=[""]),
            _b("heading", level=2, text="What we will try"),
            _b("action", text="", assignee_id=None, due_date=None, task_id=None),
        ]
    return [_b("text", text="")]


TEMPLATES: tuple[dict[str, str], ...] = (
    {"key": "blank", "name": "Blank page", "icon": "📄",
     "description": "Start from nothing."},
    {"key": "meeting", "name": "Meeting notes", "icon": "🗓️",
     "description": "Agenda, notes, decisions and action items that become tasks."},
    {"key": "runbook", "name": "Runbook", "icon": "🛠️",
     "description": "Symptoms, diagnosis, the fix and who to escalate to."},
    {"key": "spec", "name": "Spec", "icon": "📐",
     "description": "Problem, goals, proposal, open questions and rollout."},
    {"key": "retro", "name": "Retrospective", "icon": "🔁",
     "description": "What went well, what did not, and what to try next."},
)


def templates(*, principal) -> dict[str, Any]:
    principal.require(VIEW)
    return {"items": [{**item, "blocks": _template_blocks(item["key"])} for item in TEMPLATES]}


def meeting_blocks(event) -> list[dict[str, Any]]:
    """A notes page pre-filled from the event: when, who, and what it is about."""
    when = event.starts_at.strftime("%A %-d %B %Y, %H:%M") if isinstance(event.starts_at, datetime) else ""
    people = [
        item.get("name") or item.get("email") or "Somebody"
        for item in (event.participants or []) if isinstance(item, dict)
    ]
    agenda = [line.strip(" -•*\t") for line in (event.description or "").splitlines() if line.strip(" -•*\t")]
    return [
        _b("callout", tone="info",
           text=f"**{when}**" + (f" · {event.location}" if event.location else "")),
        _b("heading", level=2, text="Attendees"),
        _b("list", ordered=False, items=people or ["Nobody was invited"]),
        _b("heading", level=2, text="Agenda"),
        _b("list", ordered=True, items=agenda or [""]),
        _b("heading", level=2, text="Notes"),
        _b("text", text=""),
        _b("heading", level=2, text="Decisions"),
        _b("list", ordered=False, items=[""]),
        _b("heading", level=2, text="Action items"),
        _b("action", text="", assignee_id=None, due_date=None, task_id=None),
    ]
