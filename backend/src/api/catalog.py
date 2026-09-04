"""The data catalogue (§65) — what the platform holds and how complete it is."""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import catalog as service


@requires("records.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every dataset the caller may read, profiled."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        # `?refresh=true` skips the cache, for the moment after a reseed when
        # the numbers on screen are provably behind the database.
        refresh = str(args.get("refresh") or "").lower() in ("1", "true", "yes")
        return service.catalogue(session, principal=me(), refresh=refresh), 200


@requires("records.view")
def item(app=None, operation: str = "", request=None, resource_type=None, **_: Any):
    """One dataset's entry, or the values one of its fields actually holds."""
    args = request.args if request is not None else {}
    field = str(args.get("field") or "").strip()
    with session_scope() as session:
        principal = me()
        if field:
            return service.sample(session, resource_type, principal=principal, field=field), 200
        return service.dataset(session, resource_type, principal=principal), 200
