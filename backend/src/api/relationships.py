"""How one record connects to the rest (§44, §50)."""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import relationships as service


@requires("records.view")
def item(app=None, operation: str = "", request=None, resource_type=None, record_id=None, **_: Any):
    """Everything this record points at, and everything pointing at it."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        sample = args.get("sample")
        return service.graph(
            session, resource_type, record_id, principal=me(),
            **({"sample": int(sample)} if str(sample or "").isdigit() else {}),
        ), 200
