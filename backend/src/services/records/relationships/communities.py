"""Clustering the network into communities, and naming them."""

from __future__ import annotations

from typing import Any

from src.services.records.explorer import resources


def _cluster(
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    resource,
    focus_key: str,
    principal,
) -> dict[str, Any]:
    """Detect communities, size the nodes, and describe each cluster."""
    from src.core import graph as graph_math

    pairs = [(edge["source"], edge["target"]) for edge in edges]
    keys = sorted(nodes)
    grouping = graph_math.communities(keys, pairs)
    degree = graph_math.degrees(keys, pairs)
    crossing = {
        (source, target) for source, target in graph_math.bridges(pairs, grouping)
    }

    for key, node in nodes.items():
        node["community"] = grouping.get(key, key)
        node["degree"] = degree.get(key, 0)

    for edge in edges:
        pair = (edge["source"], edge["target"])
        edge["bridge"] = pair in crossing or (pair[1], pair[0]) in crossing

    return {
        "focus": {"key": focus_key, "label": resource.label},
        "available": [
            {"key": item.key, "label": item.label}
            for item in resources().values()
            if principal.can(item.permission)
        ],
        "nodes": [nodes[key] for key in keys],
        "edges": edges,
        "communities": _describe_communities(nodes, edges, grouping),
        "stats": {
            "nodes": len(nodes),
            "edges": len(edges),
            "communities": len(set(grouping.values())),
            # Newman's Q: above ~0.3 the clustering is structure rather than
            # noise. Shipped so the page can say how much to trust the picture.
            "modularity": graph_math.modularity(keys, pairs, grouping),
            "bridges": len(crossing),
        },
    }


def _describe_communities(
    nodes: dict[str, dict[str, Any]],
    edges: list[dict[str, Any]],
    grouping: dict[str, str],
) -> list[dict[str, Any]]:
    """One row per cluster: what is in it, who leads it, what it touches.

    A coloured blob is not a finding. "Nine records around Northwind Trading —
    six orders, two tickets, one project — joined to the rest through Ana
    Analyst" is, and it is readable without looking at the picture at all,
    which is what makes the analysis accessible (§55).
    """
    members: dict[str, list[dict[str, Any]]] = {}
    for key, node in nodes.items():
        members.setdefault(grouping.get(key, key), []).append(node)

    summaries = []
    for community, group in members.items():
        ranked = sorted(group, key=lambda node: (-node["degree"], node["label"]))
        mix: dict[str, int] = {}
        for node in group:
            mix[node["entity_label"]] = mix.get(node["entity_label"], 0) + 1
        inside = sum(
            1
            for edge in edges
            if grouping.get(edge["source"]) == community
            and grouping.get(edge["target"]) == community
        )
        summaries.append({
            "id": community,
            # Named after its most connected member, which is what a person
            # would call it: "the Northwind cluster".
            "label": ranked[0]["label"] if ranked else community,
            "entity": ranked[0]["entity"] if ranked else "",
            "size": len(group),
            "mix": [
                {"label": label, "count": count}
                for label, count in sorted(mix.items(), key=lambda item: -item[1])
            ],
            "members": [
                {
                    "key": node["key"],
                    "id": node["id"],
                    "label": node["label"],
                    "entity": node["entity"],
                    "entity_label": node["entity_label"],
                    "degree": node["degree"],
                    "explorable": node["explorable"],
                }
                for node in ranked[:6]
            ],
            "internal_links": inside,
            "external_links": sum(
                1
                for edge in edges
                if edge["bridge"]
                and community in (grouping.get(edge["source"]), grouping.get(edge["target"]))
            ),
        })

    summaries.sort(key=lambda item: (-item["size"], item["label"]))
    return summaries
