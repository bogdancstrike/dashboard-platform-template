"""Seed checks: orphaned references, export files and import runs."""

from __future__ import annotations

from sqlalchemy import select

from src.models.business import Order, Project, Task, Ticket
from src.models.content import Comment, EmailMessage, EmailThread, FileObject
from src.models.identity import Department, Team, User
from src.models.personal import (
    Dashboard,
    DashboardWidget,
    ResourceShare,
)
from src.models.platform import ActivityEntry, AuditLog, BackgroundJob, ImportRun
from src.services.records.explorer import resources as _resources


def check_orphans(session, problems: list[str], _orphans) -> None:
    _orphans("tasks.project_id", Task, Task.project_id, Project)
    _orphans("tasks.assignee_id", Task, Task.assignee_id, User)
    _orphans("projects.owner_id", Project, Project.owner_id, User)
    _orphans("tickets.assignee_id", Ticket, Ticket.assignee_id, User)
    _orphans("orders.owner_id", Order, Order.owner_id, User)
    _orphans("users.manager_id", User, User.manager_id, User)
    _orphans("departments.manager_id", Department, Department.manager_id, User)
    _orphans("teams.lead_id", Team, Team.lead_id, User)
    _orphans("files.owner_id", FileObject, FileObject.owner_id, User)
    _orphans("comments.author_id", Comment, Comment.author_id, User)
    _orphans("audit_logs.actor_id", AuditLog, AuditLog.actor_id, User)
    _orphans("activity.actor_id", ActivityEntry, ActivityEntry.actor_id, User)
    _orphans("jobs.initiated_by_id", BackgroundJob, BackgroundJob.initiated_by_id, User)
    _orphans("widgets.dashboard_id", DashboardWidget, DashboardWidget.dashboard_id, Dashboard)
    _orphans("messages.thread_id", EmailMessage, EmailMessage.thread_id, EmailThread)

    _orphans("resource_shares.user_id", ResourceShare, ResourceShare.user_id, User)


def check_exports(session, problems: list[str], _orphans) -> None:
    # An export must not claim a file. Every one of these was true on this
    # installation before `--sync-exports` existed: three SUCCEEDED exports
    # named `exports/JOB-00000N.csv` for bytes nobody had written, and their
    # `result.rows` was a progress counter over a `total_units` drawn at
    # random — so a "finished" export reported 184,203 of 250,000 rows in a
    # file that did not exist (§30).
    claiming = [
        row
        for row in session.scalars(select(BackgroundJob).where(BackgroundJob.kind == "EXPORT"))
    ]
    for row in claiming:
        payload = row.payload or {}
        result = row.result or {}
        if not payload.get("resource_type"):
            problems.append(f"{row.reference}: export names no dataset it can be run against")
        if (
            row.status == "SUCCEEDED"
            and not result.get("artifact")
            # A discarded or expired export legitimately has no file, and says
            # which. Without this the check called every one of them broken —
            # found by the end-to-end suite, which discards what it creates.
            and not result.get("artifact_removed")
        ):
            problems.append(f"{row.reference}: a finished export with no file")
        if row.status != "SUCCEEDED" and result.get("artifact"):
            problems.append(f"{row.reference}: an unfinished export claiming a file")
        if row.processed_units > row.total_units:
            problems.append(
                f"{row.reference}: {row.processed_units} of {row.total_units} units processed"
            )
        if row.status == "SUCCEEDED" and row.processed_units != row.total_units:
            problems.append(f"{row.reference}: finished without processing every unit")
        if row.status in ("FAILED", "RETRYING") and not row.failed_units:
            problems.append(f"{row.reference}: a failed export that failed nothing")


def check_imports(session, problems: list[str], _orphans) -> None:
    # An import run must describe a file that could exist. Every one of these
    # was false on this installation before `/import` was built: the counts
    # did not add up, the mapping named fields the target does not have, the
    # row count was past what one import may carry, and an open draft held no
    # staged rows — so resuming one showed an empty wizard (§29).
    from src.core import importer as _importer
    from src.core import vocabulary

    for row in session.scalars(select(ImportRun)):
        resource = _resources().get(row.target_entity)
        if resource is None:
            problems.append(
                f"{row.reference}: imports into {row.target_entity}, which is not a dataset"
            )
            continue
        if resource.identity is None:
            problems.append(
                f"{row.reference}: imports into {row.target_entity}, which cannot be created"
            )

        columns = {str(item.get("name")) for item in (row.detected_columns or [])}
        mapping = row.column_mapping or {}
        stray_columns = sorted(set(mapping) - columns)
        if stray_columns:
            problems.append(
                f"{row.reference}: maps columns the file does not have: {stray_columns}"
            )
        stray_fields = sorted(set(mapping.values()) - set(resource.writable))
        if stray_fields:
            problems.append(
                f"{row.reference}: maps onto fields {row.target_entity} does not accept: "
                f"{stray_fields}"
            )
        if row.total_rows > _importer.MAX_ROWS:
            problems.append(
                f"{row.reference}: {row.total_rows} rows, past the {_importer.MAX_ROWS} an "
                "import may carry"
            )
        # Only once the rows have been checked — `IMPORT_COUNTED` names those
        # states. A DRAFT has been read and not yet validated, and a CANCELLED
        # run may have been abandoned from either side of that line.
        counted = row.valid_rows + row.invalid_rows + row.skipped_rows
        if (row.status in vocabulary.IMPORT_COUNTED or counted) and (
            counted != row.total_rows
        ):
            problems.append(
                f"{row.reference}: {row.valid_rows} valid + {row.invalid_rows} invalid + "
                f"{row.skipped_rows} skipped is not {row.total_rows} rows"
            )
        if row.imported_rows > row.valid_rows:
            problems.append(
                f"{row.reference}: imported {row.imported_rows} of {row.valid_rows} valid rows"
            )
        if row.status == "COMPLETED" and row.imported_rows != row.valid_rows:
            problems.append(
                f"{row.reference}: completed without importing every valid row"
            )
        if row.status in ("DRAFT", "VALIDATED"):
            staged = len(row.staged_rows or [])
            if not staged:
                problems.append(
                    f"{row.reference}: is open and holds no rows, so it cannot be resumed"
                )
            elif staged != row.total_rows:
                # An open run's total is the rows it holds. Two independent
                # numbers let a draft claim 400 rows and stage 60.
                problems.append(
                    f"{row.reference}: holds {staged} rows and claims {row.total_rows}"
                )
        if row.status == "VALIDATED" and row.valid_rows <= 0:
            # "Validated" has to mean there is something to import, or the
            # wizard offers an execute it will refuse (§76).
            problems.append(
                f"{row.reference}: is validated with no valid row in it"
            )
        if row.status not in ("DRAFT", "VALIDATED") and (row.staged_rows or []):
            problems.append(
                f"{row.reference}: has finished and still holds a copy of the file"
            )
        lines = set()
        for problem in row.errors or []:
            if "line" not in problem:
                problems.append(f"{row.reference}: an error with no line number")
                break
            lines.add(problem["line"])
        if len(lines) > max(row.invalid_rows, 0):
            # `invalid_rows` counts *lines*, so the report cannot name more of
            # them than the count admits to. It did: a repair rebuilt the
            # counts and left twelve problems describing seven bad rows.
            problems.append(
                f"{row.reference}: reports problems on {len(lines)} lines and counts "
                f"{row.invalid_rows} invalid"
            )
