"""Cross-entity search (§32) and the command palette's quick lookup (§31)."""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import search as service


@requires("records.view")
def global_search(app=None, operation: str = "", request=None, **_: Any):
    """Rank one term across every dataset the caller may read."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.search(session, args, principal=me()), 200
