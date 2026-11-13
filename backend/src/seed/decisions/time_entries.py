"""Seed data for decisions: populate_time."""

from __future__ import annotations

import random
from datetime import date, datetime, time, timedelta
from typing import Any

from sqlalchemy import func, select

from src.core.clock import now
from src.seed.decisions.personas import NOTES, RNG_SEED, _decide, _personas


def populate_time(session) -> dict[str, int]:
    from src.models.business import Project, Task, Ticket
    from src.models.identity import User
    from src.models.timekeeping import TimeEntry, Timesheet
    from src.services.decisions import approvals
    from src.services.decisions.timekeeping import week_start

    people = _personas(session)
    if "manager" not in people:
        return {"entries": 0, "timesheets": 0}
    if session.scalar(select(func.count()).select_from(TimeEntry)):
        return {"entries": 0, "timesheets": 0}
    rng = random.Random(RNG_SEED + 2)
    today = now().date()
    this_week = week_start(today)
    weeks = [this_week - timedelta(days=7 * offset) for offset in range(6, -1, -1)]

    workers = [people[name] for name in ("operator", "analyst", "manager", "admin") if name in people]
    workers += list(session.scalars(
        select(User).where(User.deleted_at.is_(None), User.status == "ACTIVE",
                           User.username.notin_(tuple(people)), User.id.in_(
                               select(Task.assignee_id).where(Task.assignee_id.is_not(None))))
        .order_by(User.created_at).limit(14)
    ).unique())
    projects = {p.id: p for p in session.scalars(select(Project).where(Project.deleted_at.is_(None))).unique()}
    any_tasks = list(session.scalars(select(Task).where(Task.deleted_at.is_(None)).limit(200)).unique())
    any_tickets = list(session.scalars(select(Ticket).where(Ticket.deleted_at.is_(None)).limit(200)).unique())

    entries = 0
    sheets = 0
    manager = people["manager"]
    for person_index, person in enumerate(workers):
        mine_tasks = [t for t in any_tasks if t.assignee_id == person.id] or rng.sample(any_tasks, min(4, len(any_tasks)))
        mine_tickets = [t for t in any_tickets if t.assignee_id == person.id] or rng.sample(any_tickets, min(3, len(any_tickets)))
        pool: list[tuple[str, Any]] = [("task", t) for t in mine_tasks[:6]] + [("ticket", t) for t in mine_tickets[:4]]
        for start in weeks:
            week_minutes = 0
            billable_minutes = 0
            for offset in range(5):
                day = start + timedelta(days=offset)
                if day > today:
                    break
                budget = rng.choice((390, 420, 450, 480, 480, 510))
                if day == today:
                    budget = min(budget, max(0, (now().hour - 8) * 60))
                clock = datetime.combine(day, time(8, rng.choice((0, 15, 30, 45))), now().tzinfo)
                while budget > 20:
                    kind, item = rng.choice(pool)
                    minutes = min(budget, rng.choice((30, 45, 60, 75, 90, 120, 150)))
                    project = projects.get(item.project_id) if item.project_id else None
                    label = f"{item.reference} · {item.title if kind == 'task' else item.subject}"
                    timed = rng.random() < 0.55
                    billable = rng.random() < (0.85 if kind == "ticket" else 0.7)
                    session.add(TimeEntry(
                        user_id=person.id, subject_type=kind, subject_id=item.id, subject_label=label[:240],
                        project_id=item.project_id,
                        customer_id=(item.customer_id if kind == "ticket" else (project.customer_id if project else None)),
                        work_date=day, started_at=clock if timed else None,
                        ended_at=clock + timedelta(minutes=minutes) if timed else None,
                        minutes=minutes, note=rng.choice(NOTES) or None, billable=billable,
                        source="TIMER" if timed else rng.choice(("MANUAL", "GRID")),
                    ))
                    entries += 1
                    clock += timedelta(minutes=minutes + rng.choice((0, 0, 15, 30)))
                    budget -= minutes
                    week_minutes += minutes
                    billable_minutes += minutes if billable else 0
            if start == this_week or not week_minutes:
                continue
            age = (this_week - start).days // 7
            status = "APPROVED"
            if age == 1:
                status = ("SUBMITTED", "SUBMITTED", "REJECTED", "DRAFT")[person_index % 4]
            if person.username == "operator" and age == 1:
                status = "SUBMITTED"
            sheet = Timesheet(user_id=person.id, week_start=start, status=status, total_minutes=week_minutes,
                              billable_minutes=billable_minutes)
            if status != "DRAFT":
                sheet.submitted_at = datetime.combine(start + timedelta(days=4), time(16, 30), now().tzinfo)
            session.add(sheet)
            session.flush()
            sheets += 1
            if status == "DRAFT":
                continue
            hours = week_minutes / 60
            approver = manager if person.id != manager.id else people.get("admin", manager)
            row = approvals.submit(
                session, kind="timesheet", requester_id=person.id, requester_label=person.full_name,
                title=f"Timesheet · week of {start.strftime('%d %b %Y')} · {hours:.1f} h",
                summary=f"{hours:.1f} hours, {billable_minutes / 60:.1f} billable.",
                subject_type="timesheet", subject_id=sheet.id, subject_label=f"{person.full_name} · {start.isoformat()}",
                link=f"/time?tab=week&week={start.isoformat()}&user={person.id}",
                payload={"timesheet_id": str(sheet.id), "week_start": start.isoformat(),
                         "total_minutes": week_minutes, "billable_minutes": billable_minutes},
                assignee_id=approver.id, created_at=sheet.submitted_at, notify=False,
            )
            sheet.approval_id = row.id
            if status in ("APPROVED", "REJECTED"):
                decided = sheet.submitted_at + timedelta(hours=rng.choice((3, 18, 26, 40)))
                comment = "" if status == "APPROVED" else "Tuesday has no project on two entries — fix and resend."
                _decide(row, approver, status, comment, decided)
                sheet.decided_at = decided
                sheet.decided_by_id = approver.id
                sheet.decision_comment = comment or None
    session.flush()
    return {"entries": entries, "timesheets": sheets}


def _holidays(today: date) -> list[dict[str, str]]:
    out = []
    for year in (today.year, today.year + 1):
        for month, day, name in ((1, 1, "New Year's Day"), (5, 1, "Labour Day"), (10, 3, "Unity Day"),
                                 (12, 25, "Christmas Day"), (12, 26, "Boxing Day")):
            out.append({"date": date(year, month, day).isoformat(), "name": name})
    return out
