"""The personal daily brief on Home (§45).

The rules version of this already exists on the page — "three things are
waiting on you". This one gathers the same facts on the server, plus a few the
strip cannot see (approvals, mentions, tickets near their SLA), adds how this
person usually works (what they open most), and asks the model to put them in
order with a reason each. The model may only *rank and explain*: every link
and every item comes from what was gathered, so it cannot invent work.

Cached per person per day; refreshing replaces the day's copy. Without a
model — none configured, the call failed, or it answered with nothing usable —
the same items are ranked by rule, and the brief says so.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core import llm
from src.core.clock import iso, now
from src.core.errors import ApiError
from src.services import ai

FEATURE = "brief"
MAX_ITEMS = 5
_OPEN_TASK = ("DONE", "CANCELLED")
_CLOSED_TICKET = ("RESOLVED", "CLOSED")


def _task_rows(session, principal, *clauses, limit: int = 3):
    from src.models.business import Task

    base = select(Task).where(Task.status.notin_(_OPEN_TASK), *clauses)
    count = session.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = session.scalars(base.order_by(Task.due_date.asc().nullslast()).limit(limit)).all()
    return count, rows


def gather(session, principal) -> dict[str, Any]:
    """Everything waiting on this person, and how they usually work."""
    from src.models.business import Task, Ticket
    from src.models.content import Comment, EmailThread
    from src.models.personal import RecentItem
    from src.models.platform import Notification

    moment = now()
    me = principal.user_id
    items: list[dict[str, Any]] = []

    def add(key: str, count: int, title: str, link: str, score: int, examples: list[dict] | None = None,
            due: Any = None) -> None:
        if count > 0:
            items.append({"key": key, "count": int(count), "title": title, "link": link, "score": score,
                          "examples": examples or [], "due": iso(due) if due else None})

    def ex_task(t) -> dict[str, Any]:
        return {"label": f"{t.reference} {t.title}", "link": f"/tasks/{t.id}", "priority": t.priority,
                "due": iso(t.due_date)}

    # Notices that need agreeing to: somebody else is waiting on it.
    try:
        from src.services import announcements

        feed = announcements.feed(session, {}, principal=principal)
        pending = [n for n in feed.get("items", []) if n.get("requires_acknowledgement") and not n.get("acknowledged_at")]
        add("acknowledgements", len(pending),
            f"{len(pending)} notice{'s' if len(pending) != 1 else ''} to agree to", "/announcements", 90,
            [{"label": n.get("title", ""), "link": "/announcements"} for n in pending[:3]])
    except ApiError:
        pass

    if principal.can("records.view"):
        breached = select(Ticket).where(
            Ticket.assignee_id == me, Ticket.status.notin_(_CLOSED_TICKET),
            (Ticket.sla_breached.is_(True)) | (Ticket.due_at < moment + timedelta(hours=24)),
        )
        n = session.scalar(select(func.count()).select_from(breached.subquery())) or 0
        rows = session.scalars(breached.order_by(Ticket.due_at.asc().nullslast()).limit(3)).all()
        add("sla", n, f"{n} ticket{'s' if n != 1 else ''} at or past SLA", "/tickets?mine=1", 88,
            [{"label": f"{t.reference} {t.subject}", "link": f"/tickets/{t.id}", "due": iso(t.due_at)} for t in rows],
            rows[0].due_at if rows else None)

    if principal.can("tasks.view"):
        n, rows = _task_rows(session, principal, Task.assignee_id == me, Task.due_date < moment)
        add("overdue", n, f"{n} task{'s' if n != 1 else ''} past due", "/tasks?mine=1", 85,
            [ex_task(t) for t in rows], rows[0].due_date if rows else None)
        n, rows = _task_rows(session, principal, Task.assignee_id == me, Task.due_date >= moment,
                             Task.due_date < moment + timedelta(days=2))
        add("due_soon", n, f"{n} task{'s' if n != 1 else ''} due in the next two days", "/tasks?mine=1", 70,
            [ex_task(t) for t in rows], rows[0].due_date if rows else None)
        n, rows = _task_rows(session, principal, Task.requester_id == me, Task.status == "IN_REVIEW")
        add("approvals", n, f"{n} task{'s' if n != 1 else ''} waiting for your review", "/tasks", 75,
            [ex_task(t) for t in rows])

    if principal.can("calendar.view"):
        try:
            from src.services import calendar

            window = calendar.window(session, {"from": iso(moment), "to": iso(moment + timedelta(days=7)), "mine": "1"},
                                     principal=principal)
            asked = [o for o in window["items"] if o.get("my_response") == "NEEDS_ACTION"]
            add("invitations", len(asked), f"{len(asked)} invitation{'s' if len(asked) != 1 else ''} to answer",
                "/calendar?view=agenda&mine=1", 65,
                [{"label": o.get("title", ""), "link": "/calendar?view=agenda&mine=1", "due": o.get("starts_at")}
                 for o in asked[:3]], asked[0]["starts_at"] if asked else None)
        except ApiError:
            pass

    # Columns, not the entity: a brief should not depend on every column the
    # comments table has grown.
    mentions = session.execute(
        select(Comment.body, Comment.resource_type, Comment.resource_id).where(Comment.mentions.any(str(me)), Comment.created_at > moment - timedelta(days=7))
        .order_by(Comment.created_at.desc()).limit(3)
    ).all()
    n = session.scalar(select(func.count()).select_from(Comment).where(
        Comment.mentions.any(str(me)), Comment.created_at > moment - timedelta(days=7))) or 0
    add("mentions", n, f"{n} mention{'s' if n != 1 else ''} this week", "/notifications", 60,
        [{"label": (c.body or "")[:80], "link": f"/{c.resource_type}s/{c.resource_id}"} for c in mentions])

    if principal.can("mail.access"):
        unread = (EmailThread.owner_id == me, EmailThread.folder == "INBOX", EmailThread.unread_count > 0)
        n = session.scalar(select(func.count()).select_from(EmailThread).where(*unread)) or 0
        important = session.scalar(select(func.count()).select_from(EmailThread).where(
            *unread, EmailThread.is_important.is_(True))) or 0
        rows = session.scalars(select(EmailThread).where(*unread).order_by(
            EmailThread.is_important.desc(), EmailThread.last_message_at.desc()).limit(3)).all()
        add("mail", n, f"{n} unread conversation{'s' if n != 1 else ''}" + (f", {important} marked important" if important else ""),
            "/mail?only=unread", 40 + (15 if important else 0),
            [{"label": t.subject, "link": f"/mail?thread={t.id}"} for t in rows])

    n = session.scalar(select(func.count()).select_from(Notification).where(
        Notification.user_id == me, Notification.is_read.is_(False))) or 0
    add("notifications", n, f"{n} unread notification{'s' if n != 1 else ''}", "/notifications", 30)

    # How they work: what they open most in the last month.
    habits = session.execute(
        select(RecentItem.resource_type, func.sum(RecentItem.visit_count))
        .where(RecentItem.user_id == me, RecentItem.visited_at > moment - timedelta(days=30))
        .group_by(RecentItem.resource_type).order_by(func.sum(RecentItem.visit_count).desc()).limit(5)
    ).all()
    top = session.scalars(
        select(RecentItem).where(RecentItem.user_id == me).order_by(RecentItem.visit_count.desc()).limit(5)
    ).all()
    signals = {
        "opens_most": [{"kind": kind, "visits": int(v or 0)} for kind, v in habits],
        "favourite_places": [{"label": r.label, "link": r.url, "visits": r.visit_count} for r in top],
    }
    # Personalise the rules too: work in an area they live in ranks a little higher.
    lived = {kind for kind, _ in habits[:2]}
    for item in items:
        area = {"overdue": "task", "due_soon": "task", "approvals": "task", "sla": "ticket", "mail": "mail",
                "invitations": "calendar"}.get(item["key"])
        if area and any(area in (k or "") for k in lived):
            item["score"] += 5
    items.sort(key=lambda i: -i["score"])
    return {"items": items, "signals": signals}


PROMPT = """You write a short daily brief for {name}, who works in Nucleus (an enterprise platform).
Today is {today}. Below, as JSON, is everything waiting on them, and how they usually work.
Rank the {limit} most important items by urgency first (deadlines passed or today, somebody else waiting),
then by how this person usually works (areas they open most). For each, write one short reason a colleague
would say out loud, naming the most important example when there is one.
Answer with JSON only:
{{"headline":"<one sentence on the day>","items":[{{"key":"<key from the input>","title":"<short title>",
"reason":"<one sentence>","urgency":"high"|"medium"|"low"}}]}}
Use only keys from the input. Never invent work or numbers."""


def _fallback(gathered: dict[str, Any]) -> dict[str, Any]:
    picked = gathered["items"][:MAX_ITEMS]
    out = []
    for item in picked:
        first = item["examples"][0]["label"] if item["examples"] else ""
        reason = {
            "acknowledgements": "Somebody is waiting for you to agree to it.",
            "sla": "These are at or past their service level.",
            "overdue": "Past the date it was promised for.",
            "due_soon": "Due before the end of tomorrow.",
            "approvals": "Somebody finished the work and is waiting for your review.",
            "invitations": "The organiser is waiting for your answer.",
            "mentions": "Somebody asked for you by name.",
            "mail": "Unanswered conversations in your inbox.",
            "notifications": "Updates you have not read yet.",
        }.get(item["key"], "Waiting on you.")
        out.append(_item(item, item["title"], f"{reason}" + (f" First: {first}." if first else ""),
                         "high" if item["score"] >= 80 else "medium" if item["score"] >= 55 else "low"))
    total = len(gathered["items"])
    headline = ("Nothing is waiting on you today." if not total else
                f"{total} kind{'s' if total != 1 else ''} of thing waiting on you — start with {out[0]['title'].lower()}.")
    return {"headline": headline, "items": out}


def _item(source: dict[str, Any], title: str, reason: str, urgency: str) -> dict[str, Any]:
    return {"key": source["key"], "title": title[:160], "reason": reason[:300], "link": source["link"],
            "urgency": urgency if urgency in ("high", "medium", "low") else "medium", "count": source["count"],
            "examples": source["examples"][:3], "due": source["due"]}


def _from_model(answer: Any, gathered: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(answer, dict) or not isinstance(answer.get("items"), list):
        return None
    by_key = {i["key"]: i for i in gathered["items"]}
    out, seen = [], set()
    for entry in answer["items"]:
        if not isinstance(entry, dict):
            continue
        source = by_key.get(str(entry.get("key")))
        if source is None or source["key"] in seen:
            continue  # an item the model made up is dropped
        seen.add(source["key"])
        out.append(_item(source, str(entry.get("title") or source["title"]), str(entry.get("reason") or ""),
                         str(entry.get("urgency") or "medium")))
        if len(out) >= MAX_ITEMS:
            break
    if not out and gathered["items"]:
        return None
    return {"headline": str(answer.get("headline") or "")[:300], "items": out}


def _serialise(row) -> dict[str, Any]:
    return {"day": row.day.isoformat(), "headline": row.headline, "items": row.items or [], "source": row.source,
            "model": row.model, "total_tokens": row.total_tokens, "generated_at": iso(row.generated_at)}


def get(session, *, principal, refresh: bool = False) -> dict[str, Any]:
    from src.models.assistant import AssistantBrief

    today = now().date()
    row = session.scalars(select(AssistantBrief).where(AssistantBrief.user_id == principal.user_id,
                                                       AssistantBrief.day == today)).first()
    if row is not None and not refresh:
        return _serialise(row)

    gathered = gather(session, principal)
    brief, source, model, tokens = None, "fallback", None, 0
    if principal.can(ai.AI_PERMISSION) and gathered["items"]:
        if refresh:
            ai.guard(session, principal, FEATURE)
        client = llm.get_client()
        payload = {"waiting": [{k: v for k, v in i.items() if k != "score"} for i in gathered["items"]],
                   "how_they_work": gathered["signals"]}
        import json

        messages = [
            {"role": "system", "content": PROMPT.format(name=principal.full_name, today=now().strftime("%A %d %B"),
                                                        limit=MAX_ITEMS)},
            {"role": "user", "content": json.dumps(payload, default=str)},
        ]
        try:
            result = client.chat(messages, json_mode=True, max_tokens=1200, user=str(principal.user_id))
            ai.record_usage(session, principal, FEATURE, result.usage, model=result.model)
            try:
                brief = _from_model(result.json(), gathered)
            except llm.LlmError:
                brief = None
            if brief is not None:
                source, model, tokens = "ai", result.model, result.usage.total_tokens
        except llm.LlmError:
            ai.record_usage(session, principal, FEATURE, status="error")
    if brief is None:
        brief = _fallback(gathered)
    if not brief["headline"]:
        brief["headline"] = _fallback(gathered)["headline"]

    if row is None:
        row = AssistantBrief(user_id=principal.user_id, day=today)
        session.add(row)
    row.headline = brief["headline"]
    row.items = brief["items"]
    row.source = source
    row.model = model
    row.total_tokens = tokens
    row.generated_at = now()
    session.flush()
    if source == "ai":
        ai.audit(session, principal, resource_type="ai_brief", resource_id=row.id, label="Wrote the daily brief",
                 metadata={"items": len(brief["items"]), "refresh": refresh})
    return _serialise(row)
