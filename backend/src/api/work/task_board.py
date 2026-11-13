"""The task board's one write of its own: where a card sits (§18).

Its own endpoint rather than a field on the record `PUT`, for the reason the
kanban move is: a drop names *neighbours*, and turning those into a rank — and
renumbering the lane when two neighbours have no room between them — is a
decision the server makes inside one transaction.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.work import task_board as service


@requires("records.view")
def place(app=None, operation: str = "", request=None, task_id=None, **_: Any):
    """Put a task in a lane between two neighbours — see the service."""
    principal = me()
    payload = request.get_json(silent=True) if request is not None else None
    with session_scope() as session:
        return service.place(session, task_id, payload, principal=principal), 200
