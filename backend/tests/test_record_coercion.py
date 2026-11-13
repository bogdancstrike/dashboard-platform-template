"""One set of rules turns a form value — or a CSV cell — into what a column stores.

`services/record_writes.coerce` is shared by the record forms and `/import`,
so every rule here is a rule both obey. Each kind of field gets its accepted
spellings and its refusals pinned, plus the collect-every-problem mode the
importer relies on and the optimistic-concurrency check (§73).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import Column, Float, Integer, Numeric, String

from src.core.errors import ConflictError, NotFoundError, ValidationError
from src.services.records import writes as rw


def _field(kind: str, *, name: str = "f", title: str = "Field", choices=(), column=None):
    return SimpleNamespace(kind=kind, name=name, title=title, choices=choices, column=column)


def _spec(minimum=None, maximum=None, required=False):
    return SimpleNamespace(minimum=minimum, maximum=maximum, required=required)


def test_blank_means_empty_for_every_kind():
    for raw in (None, "", "   "):
        assert rw._value(None, _field("number"), _spec(), raw) is None


def test_an_enum_is_upper_cased_and_checked_against_its_choices():
    status = _field("enum", title="Status", choices=("OPEN", "DONE"))
    assert rw._value(None, status, _spec(), " open ") == "OPEN"
    with pytest.raises(ValidationError, match="not a status"):
        rw._value(None, status, _spec(), "lost")
    assert rw._value(None, _field("enum"), _spec(), "anything") == "ANYTHING"  # no declared choices


@pytest.mark.parametrize(("raw", "expected"), [
    (True, True), (False, False), ("yes", True), ("1", True), ("TRUE", True), ("no", False), ("0", False),
])
def test_a_flag_accepts_the_usual_spellings(raw, expected):
    assert rw._value(None, _field("bool"), _spec(), raw) is expected


def test_a_flag_refuses_anything_else():
    with pytest.raises(ValidationError, match="true or false"):
        rw._value(None, _field("bool", title="Billable"), _spec(), "maybe")


def test_a_number_takes_its_columns_type_and_its_range():
    whole = _field("number", title="Points", column=Column("p", Integer))
    money = _field("number", title="Amount", column=Column("a", Numeric(12, 2)))
    ratio = _field("number", title="Ratio", column=Column("r", Float))
    assert rw._value(None, whole, _spec(), "7.6") == 8
    assert rw._value(None, money, _spec(), "12.50") == Decimal("12.50")
    assert rw._value(None, ratio, _spec(), 0.25) == 0.25
    with pytest.raises(ValidationError, match="must be a number"):
        rw._value(None, whole, _spec(), "seven")
    with pytest.raises(ValidationError, match="between 0 and 100"):
        rw._value(None, whole, _spec(0, 100), 101)
    with pytest.raises(ValidationError, match="at least 1"):
        rw._value(None, whole, _spec(minimum=1), 0)
    with pytest.raises(ValidationError, match="at most 5"):
        rw._value(None, whole, _spec(maximum=5), 6)


def test_a_moment_is_an_aware_utc_instant():
    due = _field("datetime", title="Due")
    assert rw._value(None, due, _spec(), "2027-03-14") == datetime(2027, 3, 14, tzinfo=UTC)
    assert rw._value(None, due, _spec(), "2027-03-14T09:30:00Z") == datetime(2027, 3, 14, 9, 30, tzinfo=UTC)
    assert rw._value(None, due, _spec(), "2027-03-14T09:30:00") == datetime(2027, 3, 14, 9, 30, tzinfo=UTC)
    with pytest.raises(ValidationError, match="date or timestamp"):
        rw._value(None, due, _spec(), "the fourteenth")


def test_a_checklist_is_a_bounded_list_of_items_with_text():
    checklist = _field("json", title="Checklist")
    assert rw._value(None, checklist, _spec(), [{"text": " a ", "done": 1}, {"text": "b"}]) == [
        {"text": "a", "done": True}, {"text": "b", "done": False}]
    for bad, says in (({"text": "a"}, "list of items"), ([{"text": "x"}] * (rw.MAX_ITEMS + 1), "at most"),
                      (["a"], "must be an object"), ([{"text": "  "}], "needs text"),
                      ([{"text": "x" * (rw.MAX_ITEM_CHARS + 1)}], "characters")):
        with pytest.raises(ValidationError, match=says):
            rw._value(None, checklist, _spec(), bad)


def test_text_respects_its_columns_length():
    title = _field("text", title="Title", column=Column("t", String(5)))
    assert rw._value(None, title, _spec(), "  short ") == "short"
    with pytest.raises(ValidationError, match="longer than 5"):
        rw._value(None, title, _spec(), "too long")
    assert rw._value(None, _field("text"), _spec(), 42) == "42"


def test_an_edit_against_a_version_that_moved_on_is_refused():
    resource = SimpleNamespace(key="task", label="Tasks", singular="task")
    stamp = datetime(2027, 1, 1, 12, tzinfo=UTC)
    row = SimpleNamespace(id="r1", updated_at=stamp)
    rw._refuse_a_lost_race(resource, row, None)  # a client that did not read first
    rw._refuse_a_lost_race(resource, row, "2027-01-01T12:00:00Z")
    rw._refuse_a_lost_race(resource, row, "2027-01-01T12:00:00")  # naive means UTC
    with pytest.raises(ConflictError, match="Somebody else changed"):
        rw._refuse_a_lost_race(resource, row, (stamp - timedelta(seconds=5)).isoformat())
    with pytest.raises(ValidationError, match="must be a timestamp"):
        rw._refuse_a_lost_race(resource, row, "yesterday")


def test_the_payload_has_to_be_an_object():
    with pytest.raises(ValidationError, match="JSON object"):
        rw._object(["not", "a", "record"])


@pytest.mark.database
def test_an_import_hears_every_problem_and_a_form_hears_the_first(app):
    from src.core.db import session_scope
    from src.services.records.explorer import resources

    task = resources()["task"]
    required = [name for name, spec in task.writable.items() if spec.required]
    with session_scope() as session:
        values, problems = rw.coerce(session, task, {"status": "LOST", "priority": "HUGE"}, creating=True)
        fields = {problem["field"] for problem in problems}
        assert {"status", "priority"} <= fields and set(required) - {"status", "priority"} <= fields
        assert values == {}

        assert rw.coerce(session, task, {"no_such": 1}, creating=False)[1][0]["message"] == \
            "Those fields cannot be written."
        assert rw.coerce(session, task, {}, creating=False)[1][0]["message"] == "Nothing to write."
        if required:
            empty = rw.coerce(session, task, {required[0]: "   "}, creating=False)[1]
            assert empty[0]["message"].endswith("cannot be empty.")

        with pytest.raises(ValidationError):
            rw._coerced(session, task, {"status": "LOST"}, creating=False)

        reference = next((task.fields.by_name[name] for name in task.writable
                          if task.fields.by_name[name].kind == "uuid"), None)
        if reference is not None:
            with pytest.raises(NotFoundError):
                rw._value(session, reference, task.writable[reference.name],
                          "00000000-0000-0000-0000-000000000000")
        read_only = next((r for r in resources().values() if not r.writable), None)
        if read_only is not None:
            assert "read-only" in rw.coerce(session, read_only, {"x": 1}, creating=True)[1][0]["message"]
        session.rollback()


# ── identifiers under a race ─────────────────────────────────────────────


@pytest.mark.database
def test_a_lost_race_for_an_identifier_is_retried_and_then_named(client, monkeypatch):
    """Two writers can compute the same `TSK-` number; the loser retries in a savepoint.

    Simulated by handing the first attempt a number that is already taken.
    """
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.business import Task
    from tests.personas import PREFIX, sign_in

    headers = sign_in(monkeypatch, "admin")
    with session_scope() as session:
        taken = session.scalar(select(Task.reference).where(Task.reference.like("TSK-%")).limit(1))
    real = rw._next_identifier
    calls = {"n": 0}

    def first_one_taken(session, resource):
        calls["n"] += 1
        return taken if calls["n"] == 1 else real(session, resource)

    monkeypatch.setattr(rw, "_next_identifier", first_one_taken)
    made = client.post(f"{PREFIX}/api/records/task", json={"title": "Race probe"}, headers=headers)
    assert made.status_code == 201, made.get_json()
    assert calls["n"] == 2 and made.get_json()["subtitle"] != taken

    # Every attempt taken: a conflict that says to try again, not a 500.
    monkeypatch.setattr(rw, "_next_identifier", lambda session, resource: taken)
    lost = client.post(f"{PREFIX}/api/records/task", json={"title": "Race probe"}, headers=headers)
    assert lost.status_code == 409 and "Try again" in lost.get_json()["message"]
