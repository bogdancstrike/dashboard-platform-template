"""Seed data for collab: seed_wiki, seed_meetings, seed."""

from __future__ import annotations

from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from src.core.clock import now
from src.seed.collab.chat import seed_chat, seed_threads
from src.seed.collab.script import _people
from src.seed.collab.wiki_pages import SPACES, _links_for, _wiki_pages


def seed_wiki(session, personas) -> dict[str, int]:
    from src.models.collab import DocPage, DocRevision, DocSpace
    from src.services.collaboration import docs

    moment = now()
    authors = [personas[key] for key in ("admin", "manager", "analyst", "operator") if key in personas]
    added = {"spaces": 0, "pages": 0}
    if not authors:
        return added
    docs.meetings_space(session, None)
    pages = _wiki_pages(session)
    for index, (key, name, icon, color, description) in enumerate(SPACES):
        space = session.scalars(select(DocSpace).where(DocSpace.key == key)).first()
        if space is None:
            space = DocSpace(key=key, name=name, icon=icon, color=color, description=description,
                             position=(index + 1) * 1024, created_by_id=authors[0].id,
                             created_at=moment - timedelta(days=40))
            session.add(space)
            session.flush()
            added["spaces"] += 1
        made: dict[str, Any] = {}
        for position, (title, page_icon, parent_title, raw_blocks) in enumerate(pages[key]):
            existing = session.scalars(
                select(DocPage).where(DocPage.space_id == space.id, DocPage.title == title,
                                      DocPage.deleted_at.is_(None))
            ).first()
            if existing is not None:
                made[title] = existing
                continue
            blocks = docs.clean_blocks(raw_blocks)
            author = authors[position % len(authors)]
            editor = authors[(position + 1) % len(authors)]
            created = moment - timedelta(days=30 - position * 3, hours=position)
            edited = moment - timedelta(days=max(0, 6 - position), hours=3 + position)
            parent = made.get(parent_title) if parent_title else None
            page = DocPage(
                space_id=space.id, parent_id=parent.id if parent else None, title=title, icon=page_icon,
                position=(position + 1) * 1024, blocks=blocks, plain_text=docs.plain_text(title, blocks),
                version=2, created_by_id=author.id, updated_by_id=editor.id,
                created_at=created, updated_at=edited,
            )
            session.add(page)
            session.flush()
            # Two versions: the first draft, a little shorter, then the edit.
            session.add(DocRevision(page_id=page.id, version=1, title=title, blocks=blocks[:-1] or blocks,
                                    note="Created", author_id=author.id, created_at=created))
            session.add(DocRevision(page_id=page.id, version=2, title=title, blocks=blocks,
                                    author_id=editor.id, created_at=edited))
            _links_for(session, page)
            made[title] = page
            added["pages"] += 1
    session.flush()
    return added


ACTIONS = (
    "Send the summary to everybody who could not attend",
    "Update the forecast with the numbers discussed",
    "Book a follow-up with the vendor",
    "Draft the rollout plan for the next release",
    "Check the open escalations against the SLA",
)


NOTES = (
    "Walked through the open items from last time; two are done, one moved to next sprint.",
    "Agreed the priorities for the coming two weeks and who owns each.",
    "Discussed the customer feedback from the latest survey; themes are onboarding and search.",
)


def seed_meetings(session, personas) -> int:
    """Notes on the most recent past meetings, with action items — some already tasks."""
    from src.models.business import CalendarEvent, Task
    from src.models.collab import DocLink, DocPage, DocRevision
    from src.services.collaboration import docs

    moment = now()
    space = docs.meetings_space(session, None)
    events = session.scalars(
        select(CalendarEvent)
        .where(CalendarEvent.deleted_at.is_(None), CalendarEvent.status != "CANCELLED",
               CalendarEvent.starts_at < moment, CalendarEvent.starts_at > moment - timedelta(days=30),
               CalendarEvent.category == "MEETING",
               # A one-off: JSON `null` and SQL NULL both mean "does not repeat".
               func.coalesce(func.jsonb_typeof(CalendarEvent.recurrence), "null") == "null")
        .order_by(CalendarEvent.starts_at.desc())
        .limit(5)
    ).all()
    tasks = session.scalars(
        select(Task).where(Task.deleted_at.is_(None), Task.assignee_id.isnot(None),
                           Task.status.notin_(("DONE", "CANCELLED")))
        .order_by(Task.created_at.desc()).limit(10)
    ).all()
    author = personas.get("admin") or next(iter(personas.values()), None)
    if author is None:
        return 0
    added = 0
    for index, event in enumerate(events):
        if session.scalar(select(func.count()).select_from(DocPage).where(DocPage.event_id == event.id)):
            continue
        blocks = docs.meeting_blocks(event)
        notes = next(block for block in blocks if block["kind"] == "text")
        notes["text"] = NOTES[index % len(NOTES)]
        decision = next(block for block in blocks if block["kind"] == "list" and block["items"] == [""])
        decision["items"] = ["Keep the current release date", "Revisit staffing in two weeks"]
        participants = [item.get("user_id") for item in (event.participants or []) if isinstance(item, dict)]
        actions = []
        for offset in range(3):
            linked = tasks[(index * 3 + offset) % len(tasks)] if tasks and offset == 0 else None
            assignee = str(linked.assignee_id) if linked else (
                participants[offset % len(participants)] if participants else str(author.id))
            actions.append({
                "kind": "action",
                "text": linked.title if linked else ACTIONS[(index + offset) % len(ACTIONS)],
                "assignee_id": assignee,
                "due_date": (moment + timedelta(days=3 + offset * 2)).date().isoformat(),
                "task_id": str(linked.id) if linked else None,
                "done": False,
            })
        blocks = [block for block in blocks if block["kind"] != "action"] + actions
        blocks = docs.clean_blocks(blocks)
        title = f"{event.title} — {event.starts_at.strftime('%Y-%m-%d')}"
        page = DocPage(
            space_id=space.id, title=title, icon="🗓️", position=(index + 1) * 1024, blocks=blocks,
            plain_text=docs.plain_text(title, blocks), version=1, template="meeting", event_id=event.id,
            created_by_id=author.id, updated_by_id=author.id,
            created_at=event.ends_at, updated_at=event.ends_at + timedelta(minutes=20),
        )
        session.add(page)
        session.flush()
        session.add(DocRevision(page_id=page.id, version=1, title=title, blocks=blocks, note="Created",
                                author_id=author.id, created_at=event.ends_at))
        for block in blocks:
            if block.get("task_id"):
                task = session.get(Task, UUID(block["task_id"]))
                session.add(DocLink(page_id=page.id, resource_type="task", resource_id=block["task_id"],
                                    label=task.title if task else "", source="ACTION",
                                    created_by_id=author.id))
        added += 1
    session.flush()
    return added


def seed(session) -> dict[str, int]:
    """Everything above, idempotently. The seed runner and `--sync-collab` both call this."""
    personas, others = _people(session)
    if not personas:
        return {"channels": 0, "messages": 0, "reactions": 0, "spaces": 0, "pages": 0, "meetings": 0}
    chat = seed_chat(session, personas, others)
    reactions = seed_threads(session, personas)
    wiki = seed_wiki(session, personas)
    meetings = seed_meetings(session, personas)
    return {**chat, "reactions": reactions, **wiki, "meetings": meetings}
