"""The critical path through the dependencies."""

from __future__ import annotations

from collections import defaultdict, deque
from datetime import date
from typing import Any

from src.services.work.timeline.spans import violates


def _name(user) -> str:
    if user is None:
        return ""
    full = getattr(user, "full_name", None) or " ".join(
        part for part in (getattr(user, "first_name", ""), getattr(user, "last_name", "")) if part
    )
    return full or getattr(user, "username", "") or getattr(user, "email", "")


def _person(user) -> dict[str, Any] | None:
    if user is None:
        return None
    name = _name(user)
    initials = "".join(part[0] for part in name.split()[:2]).upper() if name else "?"
    return {"id": str(user.id), "name": name, "initials": initials}


def _link(link, spans) -> dict[str, Any]:
    pred = spans.get(link.predecessor_id)
    succ = spans.get(link.successor_id)
    broken = bool(pred and succ and violates(pred[1], succ[0], link.lag_days))
    return {
        "id": str(link.id),
        "predecessor_id": str(link.predecessor_id),
        "successor_id": str(link.successor_id),
        "kind": link.kind,
        "lag_days": link.lag_days,
        "violated": broken,
    }


def critical_path(
    spans: dict[Any, tuple[date, date]], links: list[tuple[Any, Any, int]]
) -> set[Any]:
    """The tasks with no slack, over every linked component.

    Forward pass: a task starts at the later of its own planned start and the
    day after each predecessor (plus lag) finishes. Backward pass from the
    latest finish. A task is critical when its latest start equals its
    earliest — and only tasks that take part in a dependency are considered,
    because a lone bar is trivially "critical" and says nothing.
    """
    linked = {item for pred, succ, _lag in links for item in (pred, succ) if item in spans}
    if not linked:
        return set()
    successors: dict[Any, list[tuple[Any, int]]] = defaultdict(list)
    predecessors: dict[Any, list[tuple[Any, int]]] = defaultdict(list)
    for pred, succ, lag in links:
        if pred in linked and succ in linked:
            successors[pred].append((succ, lag))
            predecessors[succ].append((pred, lag))

    order = _topological(linked, successors, predecessors)
    if order is None:  # a cycle: nothing is reliably critical
        return set()

    length = {item: (spans[item][1] - spans[item][0]).days + 1 for item in linked}
    earliest: dict[Any, int] = {}
    origin = min(spans[item][0] for item in linked)
    for item in order:
        start = (spans[item][0] - origin).days
        for pred, lag in predecessors[item]:
            start = max(start, earliest[pred] + length[pred] + lag)
        earliest[item] = start
    finish = max(earliest[item] + length[item] for item in linked)
    latest: dict[Any, int] = {}
    for item in reversed(order):
        late_finish = finish
        for succ, lag in successors[item]:
            late_finish = min(late_finish, latest[succ] - lag)
        latest[item] = late_finish - length[item]
    return {item for item in linked if latest[item] - earliest[item] <= 0}


def _topological(nodes, successors, predecessors) -> list[Any] | None:
    incoming = {item: len(predecessors[item]) for item in nodes}
    queue = deque(sorted((item for item in nodes if incoming[item] == 0), key=str))
    order: list[Any] = []
    while queue:
        item = queue.popleft()
        order.append(item)
        for succ, _lag in successors[item]:
            incoming[succ] -= 1
            if incoming[succ] == 0:
                queue.append(succ)
    return order if len(order) == len(nodes) else None
