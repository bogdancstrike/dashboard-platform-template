"""The daily brief's raw material: what is open, due and new."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.core.clock import iso, now
from src.core.errors import ApiError

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
                          "examples": examples or [], "due": _when(due)})

    def ex_task(t) -> dict[str, Any]:
        return {"label": f"{t.reference} {t.title}", "link": f"/tasks/{t.id}", "priority": t.priority,
                "due": iso(t.due_date)}

    # Notices that need agreeing to: somebody else is waiting on it.
    try:
        from src.services.collaboration import announcements

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
            from src.services.work import calendar

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


def _when(due: Any) -> str | None:
    """A due moment as ISO text. The calendar hands its times over already
    serialised, and `iso()` on a string made the whole brief a 500 for anybody
    with an unanswered invitation (audit A)."""
    if not due:
        return None
    return due if isinstance(due, str) else iso(due)
