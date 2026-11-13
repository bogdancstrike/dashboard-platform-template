"""How records relate (§36): one record's links, the map of relations, and the clustered network.
See docs/architecture/backend/relationships.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "linkables": (
        "SAMPLE", "MAX_SAMPLE", "Linkable", "_linkables", "_label_for", "_may_read", "_plural",
        "_node", "NETWORK_LIMIT", "NETWORK_ANCHORS", "NETWORK_PER_RELATION", "NETWORK_PEOPLE",
        "_inbound_relations", "_key",
    ),
    "record_links": ("graph", "_outbound", "_inbound"),
    "relation_map": ("PROFILED_EDGES", "HUBS_PER_EDGE", "overview", "_live_count", "_hubs"),
    "record_network": ("network", "_hop_out", "_edges_within", "_node_for"),
    "anchors": (
        "_anchor_records", "_anchors_by_shared_parent", "_SelfLinkable", "_rows_per_anchor",
    ),
    "communities": ("_cluster", "_describe_communities"),
})
