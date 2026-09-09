"""Profile endpoints (§40, §41).

`@requires()` with no arguments — authenticated-only — for the reason
`/settings/security` carries the same: a page about *you* that has to be granted
is a page most people never see, and its whole value is that the person who
needs it can reach it. Which person the request is about is decided by the
server from the token; a colleague's profile withholds what the viewer may not
see, and the service says which parts those are rather than leaving a section
mysteriously blank.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import profile as service


@requires()
def mine(app=None, operation: str = "", request=None, **_: Any):
    """The signed-in reader's own page."""
    with session_scope() as session:
        return service.profile(session, None, principal=me()), 200


@requires()
def person(app=None, operation: str = "", request=None, user_id: str = "", **kwargs: Any):
    """A colleague's page, showing only what this reader may be told."""
    identifier = user_id or str(kwargs.get("user_id") or "")
    with session_scope() as session:
        return service.profile(session, identifier, principal=me()), 200
