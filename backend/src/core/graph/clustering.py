"""Adjacency, and communities by modularity (Louvain-style)."""

from __future__ import annotations

from collections import defaultdict
from typing import Iterable, Sequence

#: A hard stop, so a pathological graph cannot spin. Label propagation on real
#: data converges in single-digit rounds; anything past this is oscillation.
MAX_ROUNDS = 30


def adjacency(
    nodes: Iterable[str], edges: Iterable[tuple[str, str]]
) -> dict[str, dict[str, float]]:
    """Undirected weighted adjacency, ignoring edges that leave the node set.

    Direction is dropped on purpose. "This ticket belongs to that customer" and
    "that customer has this ticket" are one fact, and a community that depends
    on which way the foreign key happens to point is an artefact of the schema
    rather than a finding about the data.
    """
    known = set(nodes)
    weights: dict[str, dict[str, float]] = {node: {} for node in known}
    for source, target in edges:
        if source == target or source not in known or target not in known:
            continue
        weights[source][target] = weights[source].get(target, 0.0) + 1.0
        weights[target][source] = weights[target].get(source, 0.0) + 1.0
    return weights


def communities(nodes: Sequence[str], edges: Iterable[tuple[str, str]]) -> dict[str, str]:
    """Group nodes that are more connected to each other than to the rest.

    Returns one community label per node — the smallest member id, so the
    label is stable across runs and means something to a human reading the
    JSON. An isolated node is its own community, which is the honest answer:
    it belongs to nothing.
    """
    ordered = sorted(set(nodes))
    graph = {node: dict(near) for node, near in adjacency(ordered, edges).items()}
    loops = {node: 0.0 for node in ordered}
    #: Original node → the super-node it currently lives inside.
    inside = {node: node for node in ordered}

    for _ in range(MAX_ROUNDS):
        partition = _one_level(graph, loops)
        if all(partition[node] == node for node in graph):
            break
        inside = {node: partition[super_node] for node, super_node in inside.items()}
        graph, loops = _collapse(graph, loops, partition)
        if len(graph) <= 1:
            break

    return _named_after_smallest_member(inside)


def _one_level(
    graph: dict[str, dict[str, float]], loops: dict[str, float]
) -> dict[str, str]:
    """One pass of local moving: each node joins its best neighbour community.

    The gain from moving node *i* into community *C* is ``k_i_in - Σ_tot·k_i/2m``
    — the weight *i* already has inside *C*, less what it would have there by
    chance. Positive means the move explains more of the graph than randomness
    does; nothing else is a reason to move.
    """
    weight_of = {node: sum(graph[node].values()) + 2 * loops[node] for node in graph}
    total = sum(weight_of.values())
    if total == 0:
        return {node: node for node in graph}

    community = {node: node for node in graph}
    incident = dict(weight_of)
    order = sorted(graph)

    for _ in range(MAX_ROUNDS):
        moved = False
        for node in order:
            own = community[node]
            # Take the node out before scoring, or it competes with itself.
            incident[own] -= weight_of[node]

            near: dict[str, float] = defaultdict(float)
            near[own] += 0.0
            for other, weight in graph[node].items():
                if other != node:
                    near[community[other]] += weight

            best, best_gain = own, near[own] - incident[own] * weight_of[node] / total
            for candidate, shared in sorted(near.items()):
                gain = shared - incident[candidate] * weight_of[node] / total
                if gain > best_gain + 1e-12:
                    best, best_gain = candidate, gain

            incident[best] += weight_of[node]
            if best != own:
                community[node] = best
                moved = True
        if not moved:
            break
    return community


def _collapse(
    graph: dict[str, dict[str, float]],
    loops: dict[str, float],
    partition: dict[str, str],
) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """Rebuild the graph with each community as a single node.

    Weight is conserved: links inside a community become that node's self-loop,
    links between them become the edge between the two. The next level then
    runs the same local moving over a graph an order of magnitude smaller,
    which is what makes this cheap on graphs a person would actually plot.
    """
    collapsed: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))
    inner: dict[str, float] = defaultdict(float)

    for node, near in graph.items():
        here = partition[node]
        inner[here] += loops[node]
        collapsed[here]  # a community with no external link still exists
        for other, weight in near.items():
            there = partition[other]
            if here == there:
                # Each undirected pair is seen from both ends.
                inner[here] += weight / 2
            else:
                collapsed[here][there] += weight

    return (
        {node: dict(near) for node, near in collapsed.items()},
        {node: inner[node] for node in collapsed},
    )


def _named_after_smallest_member(inside: dict[str, str]) -> dict[str, str]:
    """Name each community after its smallest member rather than its seed.

    The seed is an implementation detail that can end up in a community it no
    longer represents, which reads as a bug in the JSON.
    """
    members: dict[str, list[str]] = defaultdict(list)
    for node, community in inside.items():
        members[community].append(node)
    rename = {community: min(group) for community, group in members.items()}
    return {node: rename[community] for node, community in inside.items()}
