"""Which feature owns an endpoint, read off the endpoint map."""

from __future__ import annotations

import functools
from typing import Any

from src.core.errors import ApiError
from src.core.feature_catalogue import CORE_ENDPOINTS, FEATURES, FEATURES_BY_KEY

#: The cache dataset a flag write bumps.
DATASET = "feature_flags"


#: Longest an in-process snapshot is trusted without re-reading the generation.
LOCAL_TTL = 5.0


class FeatureDisabledError(ApiError):
    code = "feature_disabled"
    status_code = 404

    def __init__(self, feature: str):
        name = FEATURES_BY_KEY[feature].name if feature in FEATURES_BY_KEY else feature
        super().__init__(f"{name} is switched off.", details={"feature": feature})
        self.feature = feature

    def to_dict(self) -> dict[str, Any]:
        return {"error": self.code, "feature": self.feature, "message": self.message}


def _endpoint_entries() -> list[dict[str, Any]]:
    """The endpoints of `maps/endpoint.json`, read here rather than through
    `src.api.endpoint_map` because the core layer may not depend on the API
    layer (tests/test_layering.py). Same file, same document."""
    return list(_load_map()["endpoints"])


@functools.lru_cache(maxsize=1)
def _load_map() -> dict[str, Any]:
    import json
    from pathlib import Path

    path = Path(__file__).resolve().parents[2] / "maps" / "endpoint.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _score(pattern: str, url: str) -> int | None:
    """How specifically `pattern` claims `url`, or None when it does not."""
    if pattern.endswith("*"):
        prefix = pattern[:-1]
        return len(prefix) if url.startswith(prefix) else None
    return 10_000 + len(pattern) if url == pattern else None


def owner_of(url: str) -> tuple[str | None, bool]:
    """(flag key, decided) for an `api_url`. `decided` is False when neither a
    flag nor the core list claims it — which the endpoint-map test refuses."""
    best: tuple[int, str | None] | None = None
    for feature in FEATURES:
        for pattern in feature.endpoints:
            score = _score(pattern, url)
            if score is not None and (best is None or score > best[0]):
                best = (score, feature.key)
    for pattern in CORE_ENDPOINTS:
        score = _score(pattern, url)
        if score is not None and (best is None or score > best[0]):
            best = (score, None)
    if best is None:
        return None, False
    return best[1], True


def endpoint_owners() -> dict[str, str | None]:
    """`api_url` → owning flag (None for core) for every endpoint in the map."""
    return {entry["api_url"]: owner_of(entry["api_url"])[0] for entry in _endpoint_entries()}


def endpoints_of(key: str) -> list[dict[str, Any]]:
    """The endpoints one flag owns, as `METHOD /url` rows for the admin screen."""
    return [
        {"methods": [m.upper() for m in entry["request_method"]], "url": entry["api_url"]}
        for entry in _endpoint_entries()
        if owner_of(entry["api_url"])[0] == key
    ]
