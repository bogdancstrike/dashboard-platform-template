"""Community detection over an edge list (`src/core/graph.py`).

No database and no HTTP: the algorithm is a pure function over an edge list,
so it is tested on graphs whose right answer is known by construction. That
matters more than it usually does — a clustering is hard to eyeball, and a
subtly wrong one still produces a picture that looks plausible.
"""

from __future__ import annotations

import itertools

from src.core.graph import adjacency, bridges, communities, degrees, modularity


def _clique(prefix: str, size: int) -> tuple[list[str], list[tuple[str, str]]]:
    nodes = [f"{prefix}{index}" for index in range(size)]
    return nodes, list(itertools.combinations(nodes, 2))


def test_two_cliques_joined_by_one_edge_are_two_communities():
    left, left_edges = _clique("l", 4)
    right, right_edges = _clique("r", 4)
    nodes = left + right
    edges = [*left_edges, *right_edges, ("l0", "r0")]

    found = communities(nodes, edges)

    assert len({found[node] for node in left}) == 1
    assert len({found[node] for node in right}) == 1
    assert found["l0"] != found["r0"]
    # And the joining edge is named as what it is.
    assert bridges(edges, found) == [("l0", "r0")]


def test_the_partition_is_scored_so_the_reader_knows_what_to_trust():
    nodes, edges = [], []
    for group in range(3):
        members, links = _clique(f"c{group}_", 5)
        nodes += members
        edges += links
    edges += [("c0_0", "c1_0"), ("c1_0", "c2_0")]

    found = communities(nodes, edges)

    # Three cliques barely touching is about as clustered as a graph gets;
    # anything under 0.3 would mean the partition is noise.
    assert modularity(nodes, edges, found) > 0.55


def test_a_graph_with_no_structure_scores_near_zero():
    # A ring: every node has exactly two neighbours and no cluster exists.
    nodes = [f"n{index}" for index in range(12)]
    edges = [(nodes[index], nodes[(index + 1) % 12]) for index in range(12)]

    found = communities(nodes, edges)

    # A ring *can* be cut into arcs, but the score has to stay modest — the
    # number is what stops a picture from implying more than the data says.
    assert modularity(nodes, edges, found) < 0.75


def test_the_answer_does_not_depend_on_the_order_the_edges_arrive_in():
    # The reason this is not label propagation: a picture people compare
    # between reloads may not be redrawn differently each time.
    nodes, edges = [], []
    for group in range(4):
        members, links = _clique(f"g{group}_", 4)
        nodes += members
        edges += links
    edges += [("g0_0", "g1_0"), ("g2_0", "g3_0"), ("g1_1", "g2_1")]

    first = communities(nodes, edges)
    second = communities(list(reversed(nodes)), list(reversed(edges)))

    assert first == second


def test_an_isolated_node_belongs_to_nothing_rather_than_to_the_nearest_cluster():
    nodes, edges = _clique("c", 4)
    nodes.append("alone")

    found = communities(nodes, edges)

    assert found["alone"] == "alone"
    assert found["alone"] != found["c0"]


def test_a_community_is_named_after_its_smallest_member_not_its_seed():
    nodes, edges = _clique("m", 5)

    found = communities(nodes, edges)

    assert set(found.values()) == {"m0"}


def test_degree_counts_distinct_neighbours_not_repeated_links():
    # Five orders from one customer make that customer one connection, five
    # times over. Sizing a circle by the total would say "important" about a
    # duplicate.
    nodes = ["hub", "spoke"]
    edges = [("hub", "spoke")] * 5

    assert degrees(nodes, edges) == {"hub": 1, "spoke": 1}
    assert adjacency(nodes, edges)["hub"]["spoke"] == 5.0


def test_edges_to_nodes_that_were_cut_are_ignored_rather_than_invented():
    # The network endpoint caps its node count; an edge whose other end did
    # not make the cap must not create a phantom node.
    found = communities(["a", "b"], [("a", "b"), ("a", "ghost")])

    assert set(found) == {"a", "b"}


def test_an_empty_graph_is_not_a_special_case_anywhere():
    assert communities([], []) == {}
    assert degrees([], []) == {}
    assert modularity([], [], {}) == 0.0
    assert bridges([], {}) == []
