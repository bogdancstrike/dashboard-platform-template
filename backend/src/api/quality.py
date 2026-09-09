"""Data-quality endpoints (§65).

`records.view` and nothing narrower: what these return is a *count of rows the
reader can already see*, filtered by the same operators the list bar carries.
A separate permission would mean an installation could grant somebody a list
and withhold the news that a tenth of it contradicts itself.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import quality as service


@requires("records.view")
def overview(app=None, operation: str = "", request=None, **_: Any):
    """Every check, counted, with somewhere to go for each.

    `?resource_type=ticket` narrows it to one dataset, which is what the
    indicator on a list links to.
    """
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.overview(
            session, principal=me(), resource_key=args.get("resource_type") or ""
        ), 200


@requires("records.view")
def summary(
    app=None, operation: str = "", request=None, resource_type: str = "", **kwargs: Any
):
    """Just the counts for one dataset, for the chip on its list page."""
    kind = resource_type or str(kwargs.get("resource_type") or "")
    with session_scope() as session:
        return service.summary(session, kind, principal=me()), 200
