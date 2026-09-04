"""The people directory, behind `users.view` (§12).

Every role including VIEWER holds `users.view`, because sharing your own work
with a colleague should not require permission to administer them.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import directory as service


@requires("users.view")
def people(app=None, operation: str = "", request=None, **_: Any):
    """Search active colleagues, for share and assignment pickers."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.people(session, args, principal=me()), 200
