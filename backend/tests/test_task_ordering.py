"""The task board's hand-made order (§18): `POST /api/tasks/<id>/place`.

A drop names its neighbours and the server writes a rank between them, so the
order a person arranged is the order a reload shows. These pin the four
promises behind that: a card lands exactly between the cards it was dropped
between, a move writes one row, a lane with no room left is renumbered rather
than refused, and the write is refused for the reasons every record write is.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
#: A lane the seeded board barely uses, so the cards made here are easy to find.
LANE = "CANCELLED"

pytestmark = pytest.mark.database


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"ordering-{username}"),
    )
    return {"Authorization": f"Bearer ordering-{username}"}


def _task(client, headers, title: str) -> dict:
    made = client.post(
        f"{PREFIX}/api/records/task", json={"title": title, "status": "NEW"}, headers=headers
    )
    assert made.status_code == 201, made.get_data(as_text=True)
    return made.get_json()


def _place(client, headers, task_id, **body):
    return client.post(f"{PREFIX}/api/tasks/{task_id}/place", json=body, headers=headers)


def _lane(client, headers, ids: set[str]) -> list[str]:
    """The lane in board order, narrowed to the cards this test made."""
    response = client.post(
        f"{PREFIX}/api/explorer/query",
        headers=headers,
        json={
            "resource_type": "task", "filters": {"status": LANE},
            "columns": ["reference", "board_position"], "sort": "board_position",
            "order": "asc", "page": 1, "page_size": 200,
        },
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return [item["id"] for item in response.get_json()["items"] if item["id"] in ids]


def _ranks(ids) -> dict[str, float]:
    from src.core.db import session_scope
    from src.models.business import Task

    with session_scope() as session:
        rows = session.scalars(select(Task).where(Task.id.in_(list(ids)))).all()
        return {str(row.id): float(row.board_position) for row in rows}


def test_a_card_lands_between_the_cards_it_was_dropped_between(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    a, b, c = (_task(client, headers, f"Ordering {name}")["id"] for name in "ABC")
    ids = {a, b, c}

    # Into the lane: A at the top, B directly after A, C above A.
    first = _place(client, headers, a, status=LANE, after_id=None, before_id=None)
    assert first.status_code == 200, first.get_data(as_text=True)
    assert first.get_json()["status"] == LANE
    assert _place(client, headers, b, status=LANE, after_id=a, before_id=None).status_code == 200
    assert _place(client, headers, c, status=LANE, after_id=None, before_id=a).status_code == 200
    assert _lane(client, headers, ids) == [c, a, b]

    # Reordered within the lane: B between C and A — and only B was written.
    before = _ranks(ids)
    moved = _place(client, headers, b, status=LANE, after_id=c, before_id=a)
    assert moved.status_code == 200
    after = _ranks(ids)
    assert after[a] == before[a] and after[c] == before[c]
    assert before[c] < after[b] < before[a]
    assert _lane(client, headers, ids) == [c, b, a]


def test_after_a_card_means_directly_after_it_not_the_end_of_the_lane(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    a, b, c = (_task(client, headers, f"Adjacent {name}")["id"] for name in "ABC")
    ids = {a, b, c}
    _place(client, headers, a, status=LANE)
    _place(client, headers, b, status=LANE, after_id=a)
    # The client saw A as the last card on screen; B was below, out of view.
    _place(client, headers, c, status=LANE, after_id=a, before_id=None)
    assert _lane(client, headers, ids) == [a, c, b]


def test_a_lane_with_no_room_left_is_renumbered_rather_than_refused(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Task

    headers = _authenticate(monkeypatch)
    a, b, c = (_task(client, headers, f"Crowded {name}")["id"] for name in "ABC")
    _place(client, headers, a, status=LANE)
    _place(client, headers, c, status=LANE, after_id=a)
    _place(client, headers, b, status=LANE)

    # Two neighbours with nothing between them.
    with session_scope() as session:
        rows = {str(row.id): row for row in session.scalars(select(Task).where(Task.id.in_([a, c])))}
        rows[c].board_position = rows[a].board_position + 1e-9

    placed = _place(client, headers, b, status=LANE, after_id=a, before_id=c)
    assert placed.status_code == 200, placed.get_data(as_text=True)
    ranks = _ranks({a, b, c})
    assert ranks[a] < ranks[b] < ranks[c]


def test_a_move_between_lanes_is_a_status_change_on_the_record(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    task = _task(client, headers, "Lane change")
    assert _place(client, headers, task["id"], status="ASSIGNED").status_code == 200
    record = client.get(f"{PREFIX}/api/records/task/{task['id']}", headers=headers).get_json()
    values = record.get("values", record)
    assert values["status"] == "ASSIGNED"


def test_the_write_is_refused_for_the_reasons_every_record_write_is(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    task = _task(client, headers, "Refusals")

    itself = _place(client, headers, task["id"], status=LANE, after_id=task["id"])
    assert itself.status_code == 400

    stale = _place(
        client, headers, task["id"], status=LANE, expected_updated_at="2001-01-01T00:00:00Z"
    )
    assert stale.status_code == 409

    unknown = _place(client, headers, "00000000-0000-0000-0000-000000000000", status=LANE)
    assert unknown.status_code == 404

    bad_status = _place(client, headers, task["id"], status="NOT_A_STATUS")
    assert bad_status.status_code == 400

    reader = _authenticate(monkeypatch, "analyst", "analyst")
    refused = _place(client, reader, task["id"], status=LANE)
    assert refused.status_code == 403
