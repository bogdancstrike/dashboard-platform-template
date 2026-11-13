"""Record version history with point-in-time restore (§17)."""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import record_versions as service


def _args(request):
    return request.args if request is not None else {}


@requires("records.view")
def versions(app=None, operation: str = "", request=None, **kwargs: Any):
    """Every version of a record, or the one in force at `?at=`."""
    with session_scope() as session:
        return service.history(session, kwargs.get("resource_type"), kwargs.get("record_id"),
                               _args(request), principal=me()), 200


@requires("records.view")
def compare(app=None, operation: str = "", request=None, **kwargs: Any):
    """Two versions side by side (`?a=&b=`)."""
    with session_scope() as session:
        return service.compare(session, kwargs.get("resource_type"), kwargs.get("record_id"),
                               _args(request), principal=me()), 200


@requires("records.view")
def restore(app=None, operation: str = "", request=None, **kwargs: Any):
    """Restore a whole version, or chosen fields of it. Audited as RESTORE."""
    with session_scope() as session:
        return service.restore(session, kwargs.get("resource_type"), kwargs.get("record_id"),
                               json_body(), principal=me()), 200
