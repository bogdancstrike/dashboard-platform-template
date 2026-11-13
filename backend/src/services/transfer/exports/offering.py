"""What can be exported, and an estimate before queueing."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core.export import CONTENT_TYPES, FORMATS, MAX_ROWS, MAX_XLSX_ROWS, limit_for
from src.core.query import count_of
from src.models.platform import BackgroundJob
from src.services.records import explorer
from src.services.transfer.exports.policy import (
    _PENDING,
    KIND,
    MAX_PENDING_PER_PERSON,
    PERMISSION,
    _expired,
    max_rows,
    retention_days,
    stalled,
)
from src.services.transfer.exports.reading import _mine


def catalogue(session, *, principal) -> dict[str, Any]:
    """What can be exported, how large it may be, and where mine stand."""
    principal.require(PERMISSION)

    datasets = [
        {
            "key": resource.key,
            "label": resource.label,
            "description": resource.description,
            "columns": list(resource.default_columns),
            "fields": [
                {"name": field.name, "label": field.title, "kind": field.kind}
                for field in resource.fields.fields
            ],
        }
        for resource in sorted(explorer.resources().values(), key=lambda item: item.label)
        if principal.can(resource.permission)
    ]

    # Counted in PostgreSQL rather than by loading the rows: this is somebody's
    # own list today and their two years of exports eventually (§71).
    tallied = session.execute(
        select(BackgroundJob.status, func.count(BackgroundJob.id))
        .where(BackgroundJob.kind == KIND, BackgroundJob.initiated_by_id == principal.user_id)
        .group_by(BackgroundJob.status)
    ).all()
    statuses = {status: int(count) for status, count in tallied}

    days = retention_days(session)
    ceiling = max_rows(session)
    # Expiry is derived from `finished_at` and a setting, so the only rows that
    # can be expired are the finished ones — which is a short list to read.
    finished = session.scalars(
        _mine(principal).where(BackgroundJob.status == "SUCCEEDED")
    ).all()
    # Likewise "stalled": only a pending row can be one.
    pending_rows = session.scalars(
        _mine(principal).where(BackgroundJob.status.in_(_PENDING))
    ).all()
    stuck = sum(1 for row in pending_rows if stalled(row))
    waiting = [row for row in pending_rows if not stalled(row)]

    return {
        "datasets": datasets,
        "formats": [
            {
                "key": fmt,
                "label": fmt.upper(),
                "content_type": CONTENT_TYPES[fmt],
                # The spreadsheet ceiling is a property of the format — a zip
                # container has to be finished before it can be sent — so the
                # setting bounds it but cannot raise it.
                "maximum": min(ceiling, MAX_XLSX_ROWS) if fmt == "xlsx" else ceiling,
            }
            for fmt in FORMATS
        ],
        "max_rows": ceiling,
        "streams_up_to": MAX_ROWS,
        "retention_days": days,
        "pending_limit": MAX_PENDING_PER_PERSON,
        "pending": len(waiting),
        "stalled": stuck,
        "statuses": [{"key": status, "count": statuses[status]} for status in sorted(statuses)],
        "total": sum(statuses.values()),
        "expired": sum(1 for row in finished if _expired(row, days)),
        "ready": sum(
            1
            for row in finished
            if (row.result or {}).get("artifact") and not _expired(row, days)
        ),
    }


def estimate(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """How many rows this question has, before anybody commits to a file.

    Its own endpoint because the answer changes what the page should offer: a
    small export should be the immediate download, and a page that queued a
    forty-row CSV as a background job would be a page adding a step for
    nothing.
    """
    principal.require(PERMISSION)
    plan = explorer.plan_for(payload, principal=principal)
    total = count_of(session, explorer.statement_of(plan))
    ceiling = max_rows(session)

    return {
        "resource_type": plan.resource_type,
        "format": plan.fmt,
        "description": plan.describe(),
        "columns": list(plan.columns),
        "rows": total,
        "maximum": ceiling,
        "streams_up_to": MAX_ROWS,
        # What the page should do with it: download it now, or queue it. The
        # streaming ceiling is `core/export`'s own, asked of it rather than
        # restated, so the answer here and the refusal there agree.
        "can_stream": total <= limit_for(plan.fmt),
        "can_queue": total <= ceiling,
        "too_large": total > ceiling,
    }
