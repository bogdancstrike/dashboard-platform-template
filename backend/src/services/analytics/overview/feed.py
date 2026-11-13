"""The recent-activity strip (§35)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import iso


def recent_activity(session, limit: int = 12) -> list[dict[str, Any]]:
    from src.models.platform import ActivityEntry

    rows = session.scalars(
        select(ActivityEntry).order_by(ActivityEntry.occurred_at.desc()).limit(limit)
    ).all()
    return [
        {
            "id": str(row.id),
            "kind": row.kind,
            "action": row.action,
            "actor": row.actor_label,
            "summary": row.summary,
            "resource_type": row.resource_type,
            "resource_id": row.resource_id,
            "resource_label": row.resource_label,
            "occurred_at": iso(row.occurred_at),
        }
        for row in rows
    ]
