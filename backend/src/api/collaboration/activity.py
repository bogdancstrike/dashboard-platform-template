"""The activity feed (§35).

One endpoint, and deliberately not `/api/audit/timeline`: that answers "what
was done to *this record*, exactly" and sits behind `audit.view`; this answers
"what has been going on" and needs only `records.view`. See
`services/activity.py` for why the line is there.
"""

from __future__ import annotations

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.collaboration import activity as service


@requires("records.view")
@endpoint
def collection(call: Call):
    """One page of the feed, with a count per kind over the whole match."""
    args = call.args
    with session_scope() as session:
        return service.feed(session, args, principal=me()), 200
