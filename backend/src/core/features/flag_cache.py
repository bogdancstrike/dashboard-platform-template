"""The flag snapshot: read once, refreshed on the cache generation."""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

from src.core.features.endpoints import DATASET, LOCAL_TTL


@dataclass(frozen=True)
class FlagState:
    key: str
    enabled: bool
    rollout_percentage: int
    target_user_ids: tuple[str, ...]
    target_roles: tuple[str, ...]
    target_group_ids: tuple[str, ...]
    target_organization_ids: tuple[str, ...]


_lock = threading.Lock()


_snapshot: dict[str, FlagState] | None = None


_snapshot_generation: int | None = None


_snapshot_at = 0.0


def _read_rows() -> dict[str, FlagState]:
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.platform import FeatureFlag

    with session_scope() as session:
        rows = session.scalars(select(FeatureFlag)).all()
        return {
            row.key: FlagState(
                key=row.key,
                enabled=bool(row.enabled),
                rollout_percentage=int(row.rollout_percentage or 0),
                target_user_ids=tuple(row.target_user_ids or ()),
                target_roles=tuple(row.target_roles or ()),
                target_group_ids=tuple(row.target_group_ids or ()),
                target_organization_ids=tuple(getattr(row, "target_organization_ids", None) or ()),
            )
            for row in rows
        }


def snapshot() -> dict[str, FlagState]:
    """Every flag's state, from the in-process cache when it is still current."""
    global _snapshot, _snapshot_generation, _snapshot_at
    from src.core import cache

    generation = cache.generations(DATASET)[DATASET]
    if (
        _snapshot is not None
        and generation == _snapshot_generation
        and time.monotonic() - _snapshot_at < LOCAL_TTL
    ):
        return _snapshot
    with _lock:
        try:
            rows = _read_rows()
        except Exception:
            # The database is unreachable. Keep answering with what was last
            # read — or, with nothing read yet, gate nothing: a flag check must
            # not be the thing that turns a database blip into every endpoint
            # failing, and the handlers will report the outage themselves.
            return _snapshot if _snapshot is not None else {}
        _snapshot, _snapshot_generation, _snapshot_at = rows, generation, time.monotonic()
        return rows


def invalidate() -> None:
    """A flag changed: every worker re-reads on its next request."""
    global _snapshot
    from src.core import cache

    _snapshot = None
    cache.bump(DATASET)
