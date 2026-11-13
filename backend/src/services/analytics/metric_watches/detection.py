"""Anomaly detection (pure): thresholds, seasonal baselines, the verdict on one point."""

from __future__ import annotations

import math
from datetime import timedelta
from typing import Any

VIEW = "records.view"


MANAGE = "alerts.manage"


MEASURES = ("count", "sum", "avg")


GRANULARITIES = {"hour": timedelta(hours=1), "day": timedelta(days=1), "week": timedelta(weeks=1)}


METHODS = ("zscore", "seasonal")


SENSITIVITY = {"low": 4.0, "medium": 3.0, "high": 2.2}


DIRECTIONS = ("both", "up", "down")


CHANNELS = ("in_app", "email")


#: How many cycles back a seasonal baseline reaches, and how long a cycle is.
SEASON_CYCLES = 4


SEASON = {"hour": 24, "day": 7, "week": 4}


#: Points drawn on a chart and examined by a backfill.
HISTORY = 30


MIN_BASELINE = 3


def threshold_of(config: dict[str, Any]) -> float:
    if config.get("threshold"):
        return float(config["threshold"])
    return SENSITIVITY.get(config.get("sensitivity") or "medium", 3.0)


def baseline(values: list[float], index: int, config: dict[str, Any]) -> list[float]:
    window = int(config.get("window") or 14)
    if config.get("method") == "seasonal":
        cycle = SEASON[config["granularity"]]
        picked = [values[index - cycle * k] for k in range(1, SEASON_CYCLES + 1) if index - cycle * k >= 0]
        return picked
    return values[max(0, index - window):index]


def judge(values: list[float], index: int, config: dict[str, Any], *, partial: bool = False) -> dict[str, Any] | None:
    """The verdict on one point: expected, spread, z, and whether it is unusual."""
    reference = baseline(values, index, config)
    if len(reference) < MIN_BASELINE:
        return None
    mean = sum(reference) / len(reference)
    spread = math.sqrt(sum((v - mean) ** 2 for v in reference) / len(reference))
    floor = max(abs(mean) * 0.1, 1.0 if (config.get("measure") or "count") == "count" else 1e-6)
    effective = max(spread, floor)
    value = values[index]
    z = (value - mean) / effective
    limit = threshold_of(config)
    direction = "up" if z > 0 else "down"
    wanted = config.get("direction") or "both"
    unusual = abs(z) >= limit and (wanted == "both" or wanted == direction)
    if partial and direction == "down":
        unusual = False
    return {
        "expected": round(mean, 4),
        "stddev": round(effective, 4),
        "zscore": round(z, 3),
        "direction": direction,
        "unusual": unusual,
        "severity": "CRITICAL" if abs(z) >= limit * 1.5 else "WARNING",
        "upper": round(mean + limit * effective, 4),
        "lower": round(max(0.0, mean - limit * effective), 4) if config.get("measure", "count") != "avg"
        else round(mean - limit * effective, 4),
    }


def annotate(points: list[dict[str, Any]], config: dict[str, Any], *, partial_last: bool = True) -> list[dict[str, Any]]:
    """The series with each point's expectation band and verdict."""
    values = [float(point["value"]) for point in points]
    out = []
    for index, point in enumerate(points):
        verdict = judge(values, index, config, partial=partial_last and index == len(points) - 1)
        out.append({**point, **({} if verdict is None else {
            "expected": verdict["expected"], "upper": verdict["upper"], "lower": verdict["lower"],
            "zscore": verdict["zscore"], "unusual": verdict["unusual"],
        })})
    return out
