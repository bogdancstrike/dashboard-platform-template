"""Time reports, the CSV export, and time logged against a record."""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, or_, select

from src.core.clock import now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.models.timekeeping import TimeEntry, Timesheet
from src.services.decisions.timekeeping.common import (
    APPROVE,
    TRACK,
    _day,
    serialize,
    week_start,
)

GROUPS = ("person", "project", "customer", "subject", "day")


def _report_clauses(session, args, principal) -> list:
    clauses = []
    if not principal.can(APPROVE):
        clauses.append(TimeEntry.user_id == principal.user_id)
    elif args.get("user_id"):
        clauses.append(TimeEntry.user_id == parse_uuid(args.get("user_id"), field="user_id"))
    start = _day(args.get("from"), field="from") if args.get("from") else now().date() - timedelta(days=29)
    end = _day(args.get("to"), field="to") if args.get("to") else now().date()
    if end < start:
        raise ValidationError("The end of the range is before its start.", details={"field": "to"})
    clauses += [TimeEntry.work_date >= start, TimeEntry.work_date <= end,
                or_(TimeEntry.ended_at.is_not(None), TimeEntry.source != "TIMER")]
    if args.get("billable") in ("true", "false"):
        clauses.append(TimeEntry.billable.is_(args.get("billable") == "true"))
    if args.get("project_id"):
        clauses.append(TimeEntry.project_id == parse_uuid(args.get("project_id"), field="project_id"))
    if args.get("customer_id"):
        clauses.append(TimeEntry.customer_id == parse_uuid(args.get("customer_id"), field="customer_id"))
    return clauses


def report(session, args, *, principal) -> dict[str, Any]:
    principal.require(TRACK)
    from src.models.business import Customer, Project
    from src.models.identity import User

    group = str(args.get("group_by") or "person")
    if group not in GROUPS:
        raise ValidationError(f"Cannot group by {group!r}.", details={"allowed": GROUPS})
    clauses = _report_clauses(session, args, principal)
    billable_sum = func.coalesce(func.sum(TimeEntry.minutes).filter(TimeEntry.billable.is_(True)), 0)
    if group == "person":
        statement = (select(User.id, User.full_name, func.sum(TimeEntry.minutes), billable_sum, func.count())
                     .join(User, User.id == TimeEntry.user_id).group_by(User.id, User.full_name))
    elif group == "project":
        statement = (select(Project.id, Project.name, func.sum(TimeEntry.minutes), billable_sum, func.count())
                     .outerjoin(Project, Project.id == TimeEntry.project_id).group_by(Project.id, Project.name))
    elif group == "customer":
        statement = (select(Customer.id, Customer.name, func.sum(TimeEntry.minutes), billable_sum, func.count())
                     .outerjoin(Customer, Customer.id == TimeEntry.customer_id)
                     .group_by(Customer.id, Customer.name))
    elif group == "subject":
        statement = (select(TimeEntry.subject_id, TimeEntry.subject_label, func.sum(TimeEntry.minutes),
                            billable_sum, func.count())
                     .group_by(TimeEntry.subject_id, TimeEntry.subject_label))
    else:
        statement = (select(TimeEntry.work_date, TimeEntry.work_date, func.sum(TimeEntry.minutes),
                            billable_sum, func.count()).group_by(TimeEntry.work_date))
    rows = session.execute(statement.select_from(TimeEntry).where(*clauses)).all()
    items = [
        {"key": str(key) if key is not None else None,
         "label": (value.isoformat() if isinstance(value, date) else value) or "Unassigned",
         "minutes": int(minutes or 0), "billable_minutes": int(bill or 0), "entries": int(count)}
        for key, value, minutes, bill, count in rows
    ]
    items.sort(key=(lambda item: item["label"]) if group == "day" else (lambda item: -item["minutes"]))
    total = sum(item["minutes"] for item in items)
    billable = sum(item["billable_minutes"] for item in items)
    return {"group_by": group, "items": items, "total_minutes": total, "billable_minutes": billable,
            "people": len({item["key"] for item in items}) if group == "person" else None,
            "can_see_everyone": principal.can(APPROVE)}


EXPORT_COLUMNS = (
    ("work_date", "Date"), ("person", "Person"), ("subject_type", "Kind"), ("subject", "Work item"),
    ("project", "Project"), ("customer", "Customer"), ("hours", "Hours"), ("minutes", "Minutes"),
    ("billable", "Billable"), ("note", "Note"), ("source", "Source"), ("timesheet", "Timesheet"),
)


def export(args, *, principal):
    """Time entries as CSV or XLSX, under exactly the report's filters."""
    principal.require(TRACK)
    from src.core import export as writer
    from src.core.db import session_scope
    from src.models.business import Customer, Project
    from src.models.identity import User

    fmt = writer.parse_format(args.get("format"))
    with session_scope() as session:
        clauses = _report_clauses(session, args, principal)
        count = session.scalar(select(func.count()).select_from(TimeEntry).where(*clauses)) or 0
        if count > writer.limit_for(fmt):
            raise ValidationError(f"{count} entries is more than one file holds; narrow the range.",
                                  details={"rows": count, "limit": writer.limit_for(fmt)})
        result = session.execute(
            select(TimeEntry, User.full_name, Project.name, Customer.name)
            .join(User, User.id == TimeEntry.user_id)
            .outerjoin(Project, Project.id == TimeEntry.project_id)
            .outerjoin(Customer, Customer.id == TimeEntry.customer_id)
            .where(*clauses)
            .order_by(TimeEntry.work_date, User.full_name)
        ).unique().all()
        weeks = {(entry.user_id, week_start(entry.work_date)) for entry, *_ in result}
        sheets = {
            (sheet.user_id, sheet.week_start): sheet.status
            for sheet in session.scalars(
                select(Timesheet).where(Timesheet.user_id.in_({user for user, _ in weeks}),
                                        Timesheet.week_start.in_({start for _, start in weeks}))
            ).unique()
        } if weeks else {}
        rows = [
            {"work_date": entry.work_date.isoformat(), "person": person,
             "subject_type": entry.subject_type, "subject": entry.subject_label,
             "project": project or "", "customer": customer or "",
             "hours": round(entry.minutes / 60, 2), "minutes": entry.minutes,
             "billable": "yes" if entry.billable else "no", "note": entry.note or "",
             "source": entry.source.title(),
             "timesheet": sheets.get((entry.user_id, week_start(entry.work_date)), "DRAFT").title()}
            for entry, person, project, customer in result
        ]
    columns = [writer.Column(name, label) for name, label in EXPORT_COLUMNS]
    return writer.response(iter(rows), columns, fmt=fmt, stem="time-entries")


def subjects(session, args, *, principal) -> dict[str, Any]:
    """What time can be booked against: my recent subjects, or a search."""
    principal.require(TRACK)
    from src.models.business import Project, Task, Ticket

    q = str(args.get("q") or "").strip()
    items: list[dict[str, Any]] = []
    if not q:
        recent = session.execute(
            select(TimeEntry.subject_type, TimeEntry.subject_id, TimeEntry.subject_label,
                   func.max(TimeEntry.created_at).label("last"))
            .where(TimeEntry.user_id == principal.user_id)
            .group_by(TimeEntry.subject_type, TimeEntry.subject_id, TimeEntry.subject_label)
            .order_by(func.max(TimeEntry.created_at).desc()).limit(8)
        ).all()
        items = [{"subject_type": kind, "subject_id": str(ident), "label": label, "recent": True}
                 for kind, ident, label, _last in recent]
        mine = session.scalars(
            select(Task).where(Task.assignee_id == principal.user_id, Task.deleted_at.is_(None),
                               Task.status.notin_(("DONE", "CANCELLED")))
            .order_by(Task.updated_at.desc()).limit(6)
        ).unique().all()
        seen = {item["subject_id"] for item in items}
        items += [{"subject_type": "task", "subject_id": str(task.id),
                   "label": f"{task.reference} · {task.title}", "recent": False}
                  for task in mine if str(task.id) not in seen]
        return {"items": items}
    like = f"%{q}%"
    for kind, model, label_cols in (("task", Task, (Task.reference, Task.title)),
                                    ("ticket", Ticket, (Ticket.reference, Ticket.subject)),
                                    ("project", Project, (Project.code, Project.name))):
        rows = session.scalars(
            select(model).where(model.deleted_at.is_(None), or_(*(col.ilike(like) for col in label_cols)))
            .order_by(model.updated_at.desc()).limit(6)
        ).unique().all()
        for row in rows:
            first, second = (getattr(row, col.key) for col in label_cols)
            items.append({"subject_type": kind, "subject_id": str(row.id), "label": f"{first} · {second}",
                          "recent": False})
    return {"items": items}


def on_subject(session, args, *, principal) -> dict[str, Any]:
    """The time on one task or ticket: total, mine, and the latest entries."""
    principal.require(TRACK)
    subject_type = str(args.get("subject_type") or "")
    subject_id = parse_uuid(args.get("subject_id"), field="subject_id")
    clauses = [TimeEntry.subject_type == subject_type, TimeEntry.subject_id == subject_id]
    if not principal.can(APPROVE):
        clauses.append(TimeEntry.user_id == principal.user_id)
    total = session.scalar(select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(*clauses)) or 0
    mine = session.scalar(select(func.coalesce(func.sum(TimeEntry.minutes), 0)).where(
        *clauses, TimeEntry.user_id == principal.user_id)) or 0
    latest = session.scalars(select(TimeEntry).where(*clauses)
                             .order_by(TimeEntry.work_date.desc(), TimeEntry.ended_at.desc().nullsfirst(),
                                       TimeEntry.created_at.desc()).limit(5)).unique().all()
    return {"total_minutes": int(total), "my_minutes": int(mine),
            "entries": [serialize(entry) for entry in latest]}
