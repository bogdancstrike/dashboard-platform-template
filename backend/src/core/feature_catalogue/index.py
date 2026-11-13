"""Retired features, core endpoints, and the catalogue by key."""

from __future__ import annotations

from src.core.feature_catalogue.catalogue import FEATURES
from src.core.feature_catalogue.model import AREAS, Feature

#: Flags an earlier catalogue seeded that no longer gate anything. The sync
#: removes them (only when off-or-untouched is irrelevant: they control nothing).
RETIRED: tuple[str, ...] = ("mobile-layout",)


#: Endpoints no flag governs, by decision. Patterns as above. The platform's
#: spine — identity, records, the explorer, administration (flags included:
#: an administrator must never be able to switch off their way back).
CORE_ENDPOINTS: tuple[str, ...] = (
    "/health/*", "/meta/*", "/api/me", "/dashboard/*", "/notifications*", "/security/*", "/recents",
    "/tags*", "/api/explorer/catalog", "/api/explorer/query", "/api/explorer/insights",
    "/api/records/<string:resource_type>", "/api/records/<string:resource_type>/<uuid:record_id>",
    "/api/records/<string:resource_type>/compare", "/api/records/<string:resource_type>/<uuid:record_id>/tags",
    "/api/tasks/<uuid:task_id>/place", "/api/tasks/<uuid:task_id>/planning", "/api/tasks/<uuid:task_id>/watchers",
    "/api/work/lanes",
    "/api/files/<uuid:file_id>*", "/api/files/blob",
    "/api/comments", "/api/comments/<uuid:comment_id>",
    "/api/announcements*", "/api/activity", "/api/audit/timeline", "/api/directory/*", "/api/profile*",
    "/admin/*",
)


FEATURES_BY_KEY: dict[str, Feature] = {feature.key: feature for feature in FEATURES}


assert len(FEATURES_BY_KEY) == len(FEATURES), "duplicate feature key"


assert all(parent in FEATURES_BY_KEY for f in FEATURES for parent in f.requires)

assert {f.area for f in FEATURES} <= {key for key, _ in AREAS}
