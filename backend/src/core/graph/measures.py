"""Degrees, modularity and bridges."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Sequence

from src.core.graph.clustering import adjacency


def degrees(nodes: Iterable[str], edges: Iterable[tuple[str, str]]) -> dict[str, int]:
    """How many distinct neighbours each node has.

    Distinct rather than total, because five orders from one customer make that
    customer one connection five times over, and sizing a circle by that says
    "important" about a duplicate.
    """
    return {node: len(near) for node, near in adjacency(nodes, edges).items()}


def modularity(
    nodes: Sequence[str], edges: Iterable[tuple[str, str]], grouping: dict[str, str]
) -> float:
    """Newman's Q for a partition: how much better than chance it is.

    0 means the grouping explains no more than a random one would; the usual
    reading is that above ~0.3 there is real structure. Returned so the page
    can say how much to trust the picture instead of implying certainty.
    """
    weights = adjacency(nodes, edges)
    total = sum(sum(near.values()) for near in weights.values())
    if total == 0:
        return 0.0

    internal: dict[str, float] = defaultdict(float)
    incident: dict[str, float] = defaultdict(float)
    for node, near in weights.items():
        community = grouping.get(node, node)
        incident[community] += sum(near.values())
        for other, weight in near.items():
            if grouping.get(other, other) == community:
                internal[community] += weight

    return round(
        sum(
            internal[community] / total - (incident[community] / total) ** 2
            for community in incident
        ),
        4,
    )


def bridges(
    edges: Iterable[tuple[str, str]], grouping: dict[str, str]
) -> list[tuple[str, str]]:
    """The edges that cross communities — where one cluster touches another.

    Usually the interesting ones: the shared account manager, the project two
    departments both work on. A cluster diagram without them is a set of
    islands, and the platform is not a set of islands.
    """
    seen: set[tuple[str, str]] = set()
    crossing = []
    for source, target in edges:
        if source == target:
            continue
        left, right = (source, target) if source <= target else (target, source)
        if (left, right) in seen:
            continue
        seen.add((left, right))
        if grouping.get(source, source) != grouping.get(target, target):
            crossing.append((source, target))
    return crossing
