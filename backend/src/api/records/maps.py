"""Records on a map (§44, §61).

Two endpoints, and deliberately not the analysis compiler's: a place is almost
always one join away — an order is drawn at its *customer's* city — and the
compiler groups a single table on purpose. See `services/maps.py` for why that
line is where it is.
"""

from __future__ import annotations

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.records import maps as service


@requires("records.view")
@endpoint
def catalogue(call: Call):
    """Which datasets can be mapped, how they reach a place, and the gazetteer."""
    return service.catalogue(principal=me()), 200


@requires("records.view")
@endpoint
def places(call: Call):
    """Where one dataset is, measured one way, over one period."""
    args = call.args
    with session_scope() as session:
        return service.places(session, args, principal=me()), 200
