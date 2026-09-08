"""Kanban boards (§18).

Six endpoints, and the shape is deliberate: a *board* is read whole (its lanes
and their cards in one request, because a column at a time is five requests to
draw one screen), while every write is the smallest thing that changed — a
lane renamed, a card moved, an order applied.

`move` is its own endpoint rather than a `PUT` on the card. Dropping a card is
not "here are the card's new fields": it renumbers its neighbours, it can move
between lanes, and it decides whether the card is finished. A generic update
that did all that as a side effect of setting `lane_id` would be a write whose
consequences are invisible at the call site.

`arrange` takes the whole lane order for the same reason the dashboard grid
does: a drag produces one new order, and applying it as a series of swaps is a
series of states a concurrent reader can observe.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import kanban as service


@requires("records.view")
def boards(app=None, operation: str = "", request=None, **_: Any):
    """Every board this reader may open, or a new one."""
    principal = me()
    if request is not None and request.method == "POST":
        with session_scope() as session:
            return (
                service.create_board(session, request.get_json(silent=True), principal=principal),
                201,
            )

    args = request.args.to_dict() if request is not None else {}
    with session_scope() as session:
        return service.boards(session, args, principal=principal), 200


@requires("records.view")
def board(app=None, operation: str = "", request=None, board_id=None, **_: Any):
    """One board whole — lanes and cards — or a change to it."""
    principal = me()
    with session_scope() as session:
        if request is not None and request.method == "PUT":
            return (
                service.update_board(
                    session, board_id, request.get_json(silent=True), principal=principal
                ),
                200,
            )
        if request is not None and request.method == "DELETE":
            return service.remove_board(session, board_id, principal=principal), 200

        args = request.args.to_dict() if request is not None else {}
        return service.board(session, board_id, args, principal=principal), 200


@requires("records.view")
def lanes(app=None, operation: str = "", request=None, board_id=None, **_: Any):
    """A new lane, or the whole column order.

    A `PUT` here is the *order* rather than one lane's fields, which is why it
    is on the collection: what a drag produces is one arrangement.
    """
    principal = me()
    payload = request.get_json(silent=True) if request is not None else None
    with session_scope() as session:
        if request is not None and request.method == "PUT":
            return service.arrange_lanes(session, board_id, payload, principal=principal), 200
        return service.create_lane(session, board_id, payload, principal=principal), 201


@requires("records.view")
def lane(app=None, operation: str = "", request=None, lane_id=None, **_: Any):
    """Rename a lane, change its limit, or remove it.

    A `DELETE` takes `?move_to=` — where its cards should go — because a lane
    that holds work cannot be removed without deciding that, and deciding it
    in the service would be the service choosing on somebody's behalf. A query
    parameter rather than a body: a `DELETE` with a body is carried unevenly
    by proxies and clients alike.
    """
    principal = me()
    with session_scope() as session:
        if request is not None and request.method == "DELETE":
            args = request.args.to_dict()
            return service.remove_lane(session, lane_id, args, principal=principal), 200
        payload = request.get_json(silent=True) if request is not None else None
        return service.update_lane(session, lane_id, payload, principal=principal), 200


@requires("records.view")
def cards(app=None, operation: str = "", request=None, board_id=None, **_: Any):
    """A new card on this board."""
    principal = me()
    payload = request.get_json(silent=True) if request is not None else None
    with session_scope() as session:
        return service.create_card(session, board_id, payload, principal=principal), 201


@requires("records.view")
def card(app=None, operation: str = "", request=None, card_id=None, **_: Any):
    """One card: read it with its family, change it, or delete it."""
    principal = me()
    payload = request.get_json(silent=True) if request is not None else None
    with session_scope() as session:
        if request is not None and request.method == "PUT":
            return service.update_card(session, card_id, payload, principal=principal), 200
        if request is not None and request.method == "DELETE":
            return service.remove_card(session, card_id, principal=principal), 200
        return service.card(session, card_id, principal=principal), 200


@requires("records.view")
def move(app=None, operation: str = "", request=None, card_id=None, **_: Any):
    """Put a card in a lane at a position — see the module docstring."""
    principal = me()
    payload = request.get_json(silent=True) if request is not None else None
    with session_scope() as session:
        return service.move_card(session, card_id, payload, principal=principal), 200
