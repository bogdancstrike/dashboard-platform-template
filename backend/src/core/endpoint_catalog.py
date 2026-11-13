"""The endpoint map as data, for the layers below the API (§31).

`src.api.endpoint_map` mounts and verifies the map; services and the seed only
need to *read* it (the developer portal's reference, the seeded API usage), and
the core layer is where a lower layer may read it from (tests/test_layering.py).
Same file, same document.
"""

from __future__ import annotations

import functools
import json
from pathlib import Path
from typing import Any

ENDPOINT_MAP = Path(__file__).resolve().parents[2] / "maps" / "endpoint.json"


@functools.lru_cache(maxsize=1)
def load() -> dict[str, Any]:
    """The whole document: namespaces, models and endpoints."""
    return json.loads(ENDPOINT_MAP.read_text(encoding="utf-8"))


def endpoints() -> list[dict[str, Any]]:
    return list(load()["endpoints"])
