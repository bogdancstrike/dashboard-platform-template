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
            unknown = set(body) - {"preferences"}
            if unknown:
                raise ValidationError(
                    "Only preferences can be updated here.",
                    details={"field": sorted(unknown)[0]},
                )
            preferences = service.update_preferences(
                session, principal.user_id, body.get("preferences")
            )
            return {"preferences": preferences}, 200
        return service.get_profile(session, principal), 200
