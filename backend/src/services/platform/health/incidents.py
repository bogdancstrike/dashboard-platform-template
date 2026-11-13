"""Incidents and uptime, derived from the history."""

from __future__ import annotations

from typing import Any

from src.core.clock import iso


def _incidents(points: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Consecutive not-healthy points, collapsed into periods."""
    out: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for point in points:
        if point["status"] == "HEALTHY":
            current = None
            continue
        if current and current["status"] == point["status"]:
            current["ended_at"] = iso(point["at"])
            current["points"] += 1
            continue
        current = {
            "status": point["status"],
            "started_at": iso(point["at"]),
            "ended_at": iso(point["at"]),
            "points": 1,
        }
        out.append(current)
    return out


def _uptime(points: list[dict[str, Any]]) -> float:
    if not points:
        return 0.0
    healthy = sum(1 for point in points if point["status"] == "HEALTHY")
    return round(healthy * 100 / len(points), 2)
