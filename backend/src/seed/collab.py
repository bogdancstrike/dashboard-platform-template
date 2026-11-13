"""Collaboration seed (§47–49): channels with history, record threads, a wiki,
and meeting notes with action items.

Unlike the generators in `business.py` and `content.py`, this module reads the
database it seeds: a channel needs real people, a meeting note needs a real
calendar event, an action item a real task. So it runs *after* the main graph
is written (`runner.run`), and the same function is the `--sync-collab` repair
for a database seeded before collaboration existed — it adds what is missing,
by name, and never touches what somebody has since written.

Every time is relative to now, so a database seeded today and one seeded in a
month both open on a chat whose last message was minutes ago.
"""

from __future__ import annotations

import random
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, select

from src.core.clock import now

PERSONAS = ("admin", "manager", "operator", "analyst", "user")

#: (name, topic, visibility, extra members beyond the personas)
CHANNELS: tuple[tuple[str, str, str, int], ...] = (
    ("general", "Company-wide announcements and the things everybody should know", "PUBLIC", 14),
    ("engineering", "Builds, releases, incidents and the occasional architecture argument", "PUBLIC", 8),
    ("support-desk", "Ticket triage, escalations and customer context", "PUBLIC", 6),
    ("sales", "Pipeline, renewals and what customers are asking for", "PUBLIC", 5),
    ("random", "Coffee, cats and weekend plans", "PUBLIC", 10),
    ("leadership", "Planning and people topics for the leadership team", "PRIVATE", 0),
)

# Each script: (minutes ago, author key, body, reactions {emoji: [author keys]}, replies)
# Author keys are persona usernames, or "p<n>" for the nth extra member.
Script = list[tuple[int, str, str, dict[str, list[str]], list[tuple[int, str, str]]]]

SCRIPTS: dict[str, Script] = {
    "general": [
        (60 * 24 * 6, "admin", "Welcome to **#general** — this is where company-wide news lands. "
         "Use threads for follow-ups so the channel stays readable.", {"👍": ["manager", "p1", "p2"], "🎉": ["p3"]}, []),
        (60 * 24 * 5, "manager", "Reminder: quarterly planning starts Monday. Agendas are in the wiki under "
         "*Product → Q4 roadmap*.", {"👀": ["operator", "analyst"]}, [
            (60 * 24 * 5 - 30, "analyst", "Will the capacity numbers be ready by then?"),
            (60 * 24 * 5 - 20, "manager", "@Ana Analyst yes — I'll share the sheet on Friday."),
        ]),
        (60 * 24 * 3, "p2", "The office Wi-Fi maintenance is tonight from 22:00 to 23:00.", {"🙏": ["p4", "user"]}, []),
        (60 * 24 * 1, "operator", "Support queue is back under 40 open tickets for the first time this month 🎉",
         {"🔥": ["admin", "manager", "p1"], "👏": ["analyst"]}, []),
        (60 * 5, "p1", "Lunch & learn on Thursday: `feature flags in practice`. Bring questions!", {"🚀": ["p3"]}, []),
        (95, "manager", "@Ada Administrator can you confirm the board deck is final before 4pm?", {}, []),
        (40, "analyst", "Dashboards for the all-hands are refreshed — the *tickets by priority* chart now "
         "includes last week.", {"✅": ["manager"]}, []),
        (12, "p3", "Has anyone seen the projector remote from room 4?", {"😄": ["p2"]}, []),
    ],
    "engineering": [
        (60 * 24 * 4, "p1", "Release **2.14** is tagged. Changelog: faster explorer queries, the new "
         "calendar drawer, and the export fix.", {"🚀": ["admin", "p2", "p3"]}, [
            (60 * 24 * 4 - 15, "p2", "Smoke tests are green on staging."),
            (60 * 24 * 4 - 10, "admin", "Nice. Ship it after the 14:00 freeze lifts."),
        ]),
        (60 * 24 * 2, "admin", "Heads up: the on-call runbook moved to the wiki — *Engineering → On-call "
         "runbook*. Please read the escalation section.", {"👀": ["p1", "p4"]}, []),
        (60 * 6, "p4", "Seeing elevated p95 on the search endpoint since the morning deploy. Investigating.",
         {"👀": ["admin", "p1"]}, [
            (60 * 6 - 25, "p1", "Probably the new index build — it finishes around noon."),
            (60 * 5, "p4", "Confirmed, back to normal now ✅"),
        ]),
        (180, "p2", "Code review queue: 3 PRs waiting on a second reviewer. @Ada Administrator could you "
         "take the auth one?", {}, []),
        (25, "p3", "Staging database will be refreshed from production snapshots at 18:00.", {"👍": ["p1"]}, []),
    ],
    "support-desk": [
        (60 * 24 * 2, "operator", "Escalating a billing dispute from a key account — details in the ticket "
         "thread.", {"👀": ["manager"]}, []),
        (60 * 20, "p1", "Macro for password resets updated with the new self-service link.", {"🙏": ["operator", "p2"]}, []),
        (60 * 3, "operator", "@Mara Manager two P1 tickets are close to breaching SLA, can we pull someone "
         "from the backlog?", {}, [
            (60 * 3 - 10, "manager", "Yes — moving Priya over for the afternoon."),
        ]),
        (55, "p2", "Customer confirmed the fix on the export issue, closing it out.", {"✅": ["operator"]}, []),
    ],
    "sales": [
        (60 * 24 * 3, "manager", "Renewals due this month are tagged in the customer list — please update "
         "the forecast by Wednesday.", {"👍": ["p1", "p2"]}, []),
        (60 * 7, "p1", "Closed the expansion with the logistics account 🎉", {"🎉": ["manager", "p2", "p3"], "🔥": ["admin"]}, []),
        (60 * 2, "p2", "Prospect asked for a security questionnaire — who owns that now?", {}, [
            (60 * 2 - 15, "manager", "@Ana Analyst has the latest answers."),
        ]),
    ],
    "random": [
        (60 * 24 * 2, "p5", "Weekend photo thread 📷", {"❤️": ["p1", "p2", "user"]}, [
            (60 * 24 * 2 - 40, "p1", "Hiked up the ridge on Saturday, finally clear skies."),
        ]),
        (60 * 9, "user", "Is the coffee machine on the 3rd floor fixed yet?", {"😢": ["p3"]}, []),
        (30, "p3", "It is! New beans too ☕", {"🙏": ["user"], "😄": ["p5"]}, []),
    ],
    "leadership": [
        (60 * 24 * 1, "admin", "Draft headcount plan is in the leadership space — comments welcome before "
         "Friday.", {"👀": ["manager"]}, []),
        (70, "manager", "Added notes on the support team. @Ada Administrator let's review tomorrow at 10.", {}, []),
    ],
}

DIRECTS: tuple[tuple[str, str, list[tuple[int, str, str]]], ...] = (
    ("admin", "manager", [
        (60 * 26, "manager", "Do you have ten minutes before the steering meeting?"),
        (60 * 25, "admin", "Sure, call me after lunch."),
        (18, "manager", "Board deck v3 is in the shared folder — the revenue slide changed."),
    ]),
    ("admin", "operator", [
        (60 * 4, "operator", "The import job failed again overnight, I re-ran it manually."),
        (60 * 3, "admin", "Thanks — I'll look at the retry policy."),
    ]),
    ("manager", "analyst", [
        (60 * 30, "manager", "Can you add churn to the weekly report?"),
        (60 * 29, "analyst", "Yes, it'll be in Monday's run."),
    ]),
)

#: How far the admin persona has read, per channel — so the demo opens with
#: something unread and a mention waiting.
ADMIN_READ_MINUTES_AGO = {"general": 100, "engineering": 200, "support-desk": 0, "sales": 0,
                          "random": 60 * 10, "leadership": 0}


def _people(session) -> tuple[dict[str, Any], list[Any]]:
    from src.models.identity import User

    personas = {
        user.username: user
        for user in session.scalars(select(User).where(User.username.in_(PERSONAS))).all()
    }
    others = session.scalars(
        select(User)
        .where(User.username.notin_(PERSONAS), User.deleted_at.is_(None), User.status == "ACTIVE")
        .order_by(User.created_at, User.username)
        .limit(24)
    ).all()
    return personas, list(others)


def _who(key: str, personas: dict[str, Any], others: list[Any]):
    if key.startswith("p") and key[1:].isdigit():
        index = int(key[1:]) - 1
        return others[index % len(others)] if others else next(iter(personas.values()))
    return personas.get(key) or next(iter(personas.values()))


def _comment(session, *, channel_id: str, author, body: str, at, parent_id=None, reactions=None):
    from src.models.content import Comment
    from src.services.collaboration.comments import _mentioned

    row = Comment(
        resource_type="chat_channel", resource_id=channel_id, parent_id=parent_id,
        author_id=author.id, body=body, mentions=_mentioned(session, body),
        reactions=reactions or None, created_at=at, updated_at=at,
    )
    session.add(row)
    session.flush()
    return row


def seed_chat(session, personas, others) -> dict[str, int]:
    from src.models.collab import ChatChannel, ChatMember, ThreadRead

    moment = now()
    added = {"channels": 0, "messages": 0}
    for name, topic, visibility, extra in CHANNELS:
        exists = session.scalar(
            select(func.count()).select_from(ChatChannel)
            .where(ChatChannel.kind == "CHANNEL", func.lower(ChatChannel.name) == name)
        )
        if exists:
            continue
        members = list(personas.values()) if visibility == "PUBLIC" else [
            personas[key] for key in ("admin", "manager") if key in personas
        ]
        members += others[:extra]
        script = SCRIPTS.get(name, [])
        oldest = max((entry[0] for entry in script), default=60) + 60 * 24
        channel = ChatChannel(
            name=name, topic=topic, kind="CHANNEL", visibility=visibility,
            created_by_id=personas["admin"].id if "admin" in personas else None,
            created_at=moment - timedelta(minutes=oldest),
        )
        seen: set[UUID] = set()
        for index, person in enumerate(members):
            if person.id in seen:
                continue
            seen.add(person.id)
            channel.members.append(ChatMember(
                user_id=person.id, role="OWNER" if index == 0 else "MEMBER",
                created_at=moment - timedelta(minutes=oldest),
            ))
        session.add(channel)
        session.flush()
        added["channels"] += 1

        last = None
        for minutes, author, body, reactions, replies in script:
            at = moment - timedelta(minutes=minutes)
            reacted = {
                emoji: [str(_who(key, personas, others).id) for key in keys]
                for emoji, keys in reactions.items()
            }
            parent = _comment(session, channel_id=str(channel.id), author=_who(author, personas, others),
                              body=body, at=at, reactions=reacted)
            added["messages"] += 1
            last = at
            for reply_minutes, reply_author, reply_body in replies:
                _comment(session, channel_id=str(channel.id), author=_who(reply_author, personas, others),
                         body=reply_body, at=moment - timedelta(minutes=reply_minutes), parent_id=parent.id)
                added["messages"] += 1
        channel.last_message_at = last

        # Read markers: everybody but the admin persona has read everything;
        # the admin has a little waiting, so the badge has something to say.
        for person_id in seen:
            read_at = moment
            if "admin" in personas and person_id == personas["admin"].id:
                read_at = moment - timedelta(minutes=ADMIN_READ_MINUTES_AGO.get(name, 0))
            session.add(ThreadRead(user_id=person_id, resource_type="chat_channel",
                                   resource_id=str(channel.id), last_read_at=read_at))

    for first, second, lines in DIRECTS:
        if first not in personas or second not in personas:
            continue
        pair = sorted({str(personas[first].id), str(personas[second].id)})
        key = ":".join(pair)
        if session.scalar(select(func.count()).select_from(ChatChannel).where(ChatChannel.direct_key == key)):
            continue
        oldest = max(entry[0] for entry in lines) + 60
        channel = ChatChannel(name="direct", kind="DIRECT", visibility="PRIVATE", direct_key=key,
                              created_by_id=personas[first].id, created_at=moment - timedelta(minutes=oldest))
        for person in pair:
            channel.members.append(ChatMember(user_id=UUID(person), role="MEMBER",
                                              created_at=moment - timedelta(minutes=oldest)))
        session.add(channel)
        session.flush()
        added["channels"] += 1
        for minutes, author, body in lines:
            _comment(session, channel_id=str(channel.id), author=personas[author], body=body,
                     at=moment - timedelta(minutes=minutes))
            added["messages"] += 1
        channel.last_message_at = moment - timedelta(minutes=min(entry[0] for entry in lines))
        # The other person has read it; the admin has the newest line waiting.
        for person in (first, second):
            read = moment if person != "admin" else moment - timedelta(minutes=min(e[0] for e in lines) + 1)
            session.add(ThreadRead(user_id=personas[person].id, resource_type="chat_channel",
                                   resource_id=str(channel.id), last_read_at=read))
    session.flush()
    return added


def seed_threads(session, personas) -> int:
    """Reactions on seeded record conversations, so a thread looks lived in."""
    from src.models.content import Comment

    rng = random.Random(4711)
    people = [str(person.id) for person in personas.values()]
    if not people:
        return 0
    already = session.scalar(
        select(func.count()).select_from(Comment)
        .where(Comment.resource_type.in_(("ticket", "task", "project", "customer")),
               func.jsonb_typeof(Comment.reactions) == "object")
    )
    if already:
        return 0
    rows = session.scalars(
        select(Comment)
        .where(Comment.resource_type.in_(("ticket", "task", "project", "customer")),
               Comment.deleted_at.is_(None),
               func.coalesce(func.jsonb_typeof(Comment.reactions), "null") == "null")
        .order_by(Comment.created_at.desc())
        .limit(120)
    ).all()
    touched = 0
    for row in rows:
        if rng.random() < 0.45:
            continue
        emoji = rng.choice(("👍", "👀", "✅", "🙏", "🎉"))
        row.reactions = {emoji: rng.sample(people, rng.randint(1, min(3, len(people))))}
        touched += 1
    session.flush()
    return touched


# ── the wiki ─────────────────────────────────────────────────────────────


def _t(kind: str, **fields: Any) -> dict[str, Any]:
    return {"kind": kind, **fields}


def _first(session, model, *clauses, order=None):
    statement = select(model).where(*clauses)
    if order is not None:
        statement = statement.order_by(order)
    return session.scalars(statement.limit(1)).first()


def _wiki_pages(session) -> dict[str, list[tuple[str, str, str | None, list[dict[str, Any]]]]]:
    """space key → [(title, icon, parent title, blocks)]."""
    from src.models.business import Customer, Project, Ticket

    project = _first(session, Project, Project.deleted_at.is_(None), order=Project.created_at)
    ticket = _first(session, Ticket, Ticket.deleted_at.is_(None), order=Ticket.created_at.desc())
    customer = _first(session, Customer, Customer.deleted_at.is_(None), order=Customer.created_at)

    def record(kind: str, row) -> list[dict[str, Any]]:
        if row is None:
            return []
        label = getattr(row, "name", None) or getattr(row, "title", None) or getattr(row, "reference", "")
        return [_t("record", resource_type=kind, resource_id=str(row.id), label=str(label))]

    return {
        "engineering": [
            ("Engineering handbook", "🛠️", None, [
                _t("callout", tone="info", text="Start here. How we build, ship and support the platform."),
                _t("heading", level=2, text="How we work"),
                _t("list", ordered=False, items=[
                    "Every change goes through review by one other engineer",
                    "Main is always deployable; feature flags hide unfinished work",
                    "Incidents get a written review within five working days",
                ]),
                _t("heading", level=2, text="Where things live"),
                _t("table", header=True, rows=[
                    ["What", "Where", "Owner"],
                    ["Source code", "Git, main branch", "Engineering"],
                    ["Runbooks", "This space", "On-call rota"],
                    ["Release notes", "#engineering", "Release manager"],
                ]),
            ]),
            ("On-call runbook", "🚨", "Engineering handbook", [
                _t("callout", tone="warning", text="Use this when the pager goes off. **Acknowledge first**, "
                   "then diagnose."),
                _t("heading", level=2, text="First five minutes"),
                _t("checklist", items=[
                    {"text": "Acknowledge the alert", "done": True},
                    {"text": "Open System health and check the failing service", "done": True},
                    {"text": "Post a short status in #engineering", "done": False},
                ]),
                _t("heading", level=2, text="Restarting the API"),
                _t("code", language="bash", text="docker compose restart api\ndocker compose logs -f api --tail 100"),
                _t("heading", level=2, text="Escalation"),
                _t("text", text="If the service is still unhealthy after 20 minutes, call the engineering "
                   "manager. Customer-facing outages also page the support lead."),
                _t("quote", text="Write down what you did as you do it — the review will thank you."),
            ]),
            ("Release checklist", "✅", "Engineering handbook", [
                _t("checklist", items=[
                    {"text": "Changelog drafted", "done": True},
                    {"text": "Migrations reviewed", "done": True},
                    {"text": "Staging smoke tests green", "done": False},
                    {"text": "Release announced in #general", "done": False},
                ]),
            ]),
            ("Architecture overview", "🏛️", None, [
                _t("text", text="The platform is a React front end over a Python API, with PostgreSQL for "
                   "records, Redis for caching and live delivery, and object storage for files."),
                _t("heading", level=2, text="Support load at a glance"),
                _t("chart", entity="ticket", dimension="status", chart="bar", aggregation="count", show="chart",
                   caption="Tickets by status"),
                _t("heading", level=2, text="Related"),
                *record("project", project),
            ]),
        ],
        "operations": [
            ("Support playbook", "📦", None, [
                _t("callout", tone="success", text="Our promise: every customer hears from a person within "
                   "one business hour."),
                _t("heading", level=2, text="Triage"),
                _t("list", ordered=True, items=[
                    "Read the whole ticket, including attachments",
                    "Set priority from the impact table below",
                    "Assign to the right queue, or take it",
                ]),
                _t("table", header=True, rows=[
                    ["Impact", "Priority", "First response"],
                    ["Many customers blocked", "Critical", "15 minutes"],
                    ["One customer blocked", "High", "1 hour"],
                    ["Workaround exists", "Normal", "1 business day"],
                ]),
                _t("heading", level=2, text="A recent example"),
                *record("ticket", ticket),
            ]),
            ("Escalation matrix", "📞", "Support playbook", [
                _t("table", header=True, rows=[
                    ["Area", "First contact", "Second contact"],
                    ["Billing", "Finance desk", "Head of finance"],
                    ["Outage", "On-call engineer", "Engineering manager"],
                    ["Security", "Security officer", "CTO"],
                ]),
            ]),
            ("Key accounts", "⭐", None, [
                _t("text", text="Accounts with a named success manager and a quarterly business review."),
                *record("customer", customer),
            ]),
        ],
        "product": [
            ("Q4 roadmap", "🗺️", None, [
                _t("heading", level=2, text="Themes"),
                _t("list", ordered=False, items=["Collaboration: chat, wiki and meeting notes",
                                                  "Faster search across every dataset",
                                                  "Self-service onboarding"]),
                _t("heading", level=2, text="Open questions"),
                _t("checklist", items=[{"text": "Do we need guest access to the wiki?", "done": False},
                                       {"text": "Pricing for the AI assistant", "done": False}]),
                *record("project", project),
            ]),
            ("Sprint retro — week 45", "🔁", "Q4 roadmap", [
                _t("heading", level=2, text="What went well"),
                _t("list", ordered=False, items=["Release went out on time", "Fewer flaky tests"]),
                _t("heading", level=2, text="What did not"),
                _t("list", ordered=False, items=["Too many meetings on Wednesday"]),
                _t("heading", level=2, text="What we will try"),
                _t("action", text="Make Wednesday afternoons meeting-free", assignee_id=None,
                   due_date=None, task_id=None, done=False),
            ]),
        ],
    }


SPACES: tuple[tuple[str, str, str, str, str], ...] = (
    ("engineering", "Engineering", "🛠️", "#2457D6", "How we build, ship and run the platform."),
    ("operations", "Operations", "📦", "#B45309", "Support, escalation and the accounts we look after."),
    ("product", "Product", "📐", "#7C3AED", "Roadmaps, specs and retrospectives."),
)


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


def _links_for(session, page) -> None:
    from src.models.collab import DocLink
    from src.services.records.explorer import resource_for

    for block in page.blocks or []:
        if block.get("kind") != "record":
            continue
        resource = resource_for(block["resource_type"])
        record = session.get(resource.model, UUID(block["resource_id"]))
        if record is None:
            continue
        session.add(DocLink(page_id=page.id, resource_type=block["resource_type"],
                            resource_id=block["resource_id"], label=resource.label_for(record),
                            source="MENTION", created_by_id=page.created_by_id))


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
