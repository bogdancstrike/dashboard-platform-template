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

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.people import profile as service


@requires()
@endpoint
def mine(call: Call):
    """The signed-in reader's own page."""
    with session_scope() as session:
        return service.profile(session, None, principal=me()), 200


@requires()
@endpoint
def person(call: Call, user_id: str = ""):
    """A colleague's page, showing only what this reader may be told."""
    identifier = user_id
    with session_scope() as session:
        return service.profile(session, identifier, principal=me()), 200
