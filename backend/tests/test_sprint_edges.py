"""Sprint planning at the edges: burndown history, cramped ranks, and the refusals.

`test_work_planning` walks a sprint from planned to completed. These pin the
parts that walk does not reach: a burndown read from stored snapshots and one
for a sprint without dates, the backlog renumbering itself when two cards have
been dragged so close there is no room between them, a card dropped next to
itself, capacity limits, and velocity's tolerance of a bad `limit`.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest

from src.core.errors import ValidationError
from src.services.work import sprints as service
from tests.personas import PREFIX, sign_in


def test_capacity_is_a_bounded_number_of_points():
    assert service._capacity(None) is None and service._capacity("") is None
    assert service._capacity("12.5") == Decimal("12.5")
    for bad in ("lots", -1, 10000):
        with pytest.raises(ValidationError):
            service._capacity(bad)


def test_a_carried_sprint_is_named_after_the_one_it_continues():
    assert service._next_name("Sprint 7") == "Sprint 8"
    assert service._next_name("Launch") == "Launch (continued)"


@pytest.mark.database
def test_a_burndown_reads_stored_days_and_needs_dates(app):
    from src.core.db import session_scope
    from src.models.planning import SprintSnapshot

    undated = SimpleNamespace(id=uuid4(), start_date=None, end_date=None)
    with session_scope() as session:
        assert service.burndown(session, undated, tasks=[]) == {"days": [], "ideal": [], "actual": [], "scope": []}

    start = date.today() - timedelta(days=4)
    finished = SimpleNamespace(id=None, start_date=start, end_date=start + timedelta(days=6),
                               committed_points=Decimal("10"), completed_at=None, state="COMPLETED")
    with session_scope() as session:
        from src.models.planning import Sprint

        sprint = Sprint(name="Burndown probe", state="COMPLETED", start_date=finished.start_date,
                        end_date=finished.end_date, committed_points=Decimal("10"))
        session.add(sprint)
        session.flush()
        finished.id = sprint.id
        session.add(SprintSnapshot(sprint_id=sprint.id, day=start + timedelta(days=1),
                                   remaining_points=Decimal("7"), total_points=Decimal("11")))
        session.flush()
        chart = service.burndown(session, finished, tasks=[])
        session.rollback()

    assert chart["ideal"][0] == 10 and chart["ideal"][-1] == 0
    assert chart["actual"][1] == 7 and chart["scope"][1] == 11
    assert chart["actual"][2] == 7          # carried forward until the next reading
    assert chart["actual"][-1] is None      # the future has no actual


@pytest.mark.database
def test_the_backlog_makes_room_when_two_cards_are_too_close(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Task

    headers = sign_in(monkeypatch, "admin")

    def task(title):
        made = client.post(f"{PREFIX}/api/records/task", json={"title": title}, headers=headers)
        assert made.status_code == 201, made.get_json()
        return made.get_json()["id"]

    first, second, mover = task("Rank probe A"), task("Rank probe B"), task("Rank probe C")
    with session_scope() as session:
        lowest = min((t.backlog_rank or 0) for t in session.query(Task).filter(Task.sprint_id.is_(None)).all())
        session.get(Task, first).backlog_rank = lowest - 10
        session.get(Task, second).backlog_rank = lowest - 10 + 1e-9

    place = f"{PREFIX}/api/work/backlog/place"
    placed = client.post(place, json={"task_id": mover, "after_id": first, "before_id": second}, headers=headers)
    assert placed.status_code == 200, placed.get_json()
    with session_scope() as session:
        a, b, c = (float(session.get(Task, i).backlog_rank) for i in (first, second, mover))
    assert a < c < b and b - a > 1  # renumbered, then placed between

    assert client.post(place, json={"task_id": mover, "after_id": mover}, headers=headers).status_code == 400
    assert client.post(place, json={"task_id": str(uuid4())}, headers=headers).status_code == 404
    # A neighbour in another list is ignored rather than trusted.
    assert client.post(place, json={"task_id": mover, "before_id": str(uuid4())}, headers=headers).status_code == 200


@pytest.mark.database
def test_velocity_tolerates_a_bad_limit(client, monkeypatch):
    headers = sign_in(monkeypatch, "admin")
    answer = client.get(f"{PREFIX}/api/work/velocity?limit=lots", headers=headers)
    assert answer.status_code == 200 and len(answer.get_json()["items"]) <= 8
