"""The authenticated caller's application-side identity (§40, §58)."""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.core.errors import ValidationError
from src.services import me as service


@requires()
def profile(app=None, operation: str = "", request=None, **_: Any):
    """Read the profile, or update a validated subset of its preferences."""
    principal = me()
    method = (request.method if request is not None else "GET").upper()

    with session_scope() as session:
        if method == "PUT":
            body = json_body()
            unknown = set(body) - {"preferences", "user"}
            if unknown:
                raise ValidationError(
                    "Only your preferences and your own details can be updated here.",
                    details={"field": sorted(unknown)[0]},
                )
            # Both in one request when both are sent, because they are one
            # save on one page — and a client that had to make two would
            # leave the second half unsent when the first failed.
            if "user" in body:
                service.update_profile(session, principal.user_id, body.get("user"))
            preferences = (
                service.update_preferences(session, principal.user_id, body["preferences"])
                if "preferences" in body
                else service.merged_preferences(None)
            )
            # The whole profile back, not only what changed: the client redraws
            # its identity chrome from this, and a partial answer would leave
            # the avatar in the header showing the old name.
            if "user" in body:
                return service.get_profile(session, principal), 200
            return {"preferences": preferences}, 200
        return service.get_profile(session, principal), 200
