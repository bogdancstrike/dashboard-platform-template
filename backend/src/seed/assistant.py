"""Seeded assistant conversations (§41), so `/assistant` opens on a history.

Written *after* the world, from rows that really exist: a Data-mode answer
cites tickets and tasks the persona can open, with the links the live
assistant would write. Dates are relative to now. Idempotent — a persona who
already has a conversation of the same title is left alone — which is what
lets `--sync-assistant` add it to a running database.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import now

PERSONAS = ("admin", "manager", "operator", "analyst", "user")
MODEL = "nucleus-chat"


def _turns(session, user) -> list[dict[str, Any]]:
    from src.models.business import Task, Ticket

    tickets = session.scalars(
        select(Ticket).where(Ticket.status.notin_(("RESOLVED", "CLOSED"))).order_by(Ticket.due_at.asc().nullslast())
        .limit(3)
    ).all()
    tasks = session.scalars(
        select(Task).where(Task.assignee_id == user.id, Task.status.notin_(("DONE", "CANCELLED")))
        .order_by(Task.due_date.asc().nullslast()).limit(3)
    ).all()
    out: list[dict[str, Any]] = [{
        "title": "Release note for the November update",
        "mode": "general",
        "ago": timedelta(days=3, hours=2),
        "messages": [
            ("user", "Draft a short release note announcing faster search and a new calendar side column."),
            ("assistant", "**November update**\n\n- **Faster search** — results arrive as you type, and filters "
                          "run on the server, so counts are always exact.\n- **Calendar side column** — a mini "
                          "month, the invitations waiting for your answer, and event kinds as toggles.\n\n"
                          "As always, the Help button on each page explains what changed there."),
        ],
    }]
    if tickets:
        rows = "\n".join(f"| [{t.reference}](/tickets/{t.id}) | {t.subject} | {t.priority.title()} |" for t in tickets)
        out.append({
            "title": "Tickets closest to their SLA",
            "mode": "data",
            "ago": timedelta(hours=20),
            "messages": [
                ("user", "Which open tickets are closest to breaching their SLA?"),
                ("assistant", f"These {len(tickets)} open tickets are due soonest:\n\n| Ticket | Subject | Priority |\n"
                              f"|---|---|---|\n{rows}\n\nI sorted every open ticket by its due time.",
                 [{"resource_type": "ticket", "id": str(t.id), "label": t.reference, "path": f"/tickets/{t.id}",
                   "dataset": "Tickets"} for t in tickets],
                 [{"name": "search_records", "arguments": {"dataset": "ticket", "sort": "due_at", "order": "asc"},
                   "summary": "Found open tickets, sorted by due time"}]),
            ],
        })
    if tasks:
        listed = "\n".join(f"- [{t.reference}](/tasks/{t.id}) — {t.title}" for t in tasks)
        out.append({
            "title": "What should I work on first?",
            "mode": "data",
            "ago": timedelta(hours=2),
            "messages": [
                ("user", "What should I work on first today?"),
                ("assistant", f"Start with the work due soonest:\n\n{listed}\n\nThe first one is the most urgent by "
                              "due date.",
                 [{"resource_type": "task", "id": str(t.id), "label": t.reference, "path": f"/tasks/{t.id}",
                   "dataset": "Tasks"} for t in tasks],
                 [{"name": "search_records", "arguments": {"dataset": "task", "sort": "due_date"},
                   "summary": "Found your open tasks"}]),
            ],
        })
    return out


def seed(session) -> dict[str, int]:
    from src.models.assistant import AssistantConversation, AssistantMessage
    from src.models.identity import User

    added = {"conversations": 0, "messages": 0}
    for username in PERSONAS:
        user = session.scalars(select(User).where(User.username == username)).first()
        if user is None:
            continue
        have = set(session.scalars(select(AssistantConversation.title).where(AssistantConversation.user_id == user.id)))
        for spec in _turns(session, user):
            if spec["title"] in have:
                continue
            start = now() - spec["ago"]
            convo = AssistantConversation(user_id=user.id, title=spec["title"], mode=spec["mode"],
                                          message_count=len(spec["messages"]), created_at=start,
                                          last_message_at=start + timedelta(seconds=40))
            session.add(convo)
            session.flush()
            for index, message in enumerate(spec["messages"]):
                role, content = message[0], message[1]
                cites = message[2] if len(message) > 2 else None
                steps = message[3] if len(message) > 3 else None
                assistant = role == "assistant"
                session.add(AssistantMessage(
                    conversation_id=convo.id, role=role, content=content, mode=spec["mode"], status="complete",
                    citations=cites, steps=steps, model=MODEL if assistant else None,
                    prompt_tokens=420 + 60 * index if assistant else 0,
                    completion_tokens=len(content) // 4 if assistant else 0,
                    total_tokens=(420 + 60 * index + len(content) // 4) if assistant else 0,
                    latency_ms=2100 if assistant else 0,
                    created_at=start + timedelta(seconds=20 * index),
                ))
                added["messages"] += 1
            added["conversations"] += 1
    session.flush()
    return added


def seed_safely(session) -> None:
    """From the main seed: never let a demo nicety fail the whole run."""
    try:
        with session.begin_nested():
            seed(session)
    except Exception as exc:  # pragma: no cover - defensive
        from framework.commons.logger import logger as log

        log.info(f"assistant seed skipped: {exc}", "yellow")
