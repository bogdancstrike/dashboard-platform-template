"""Exports that exist as things rather than as responses (§30). — off-request execution."""

from __future__ import annotations

import csv
import io
import json

import pytest

from src.core import background
from src.core import export as writer
from src.core.db import session_scope
from tests.exports_support import (  # noqa: F401
    EXPORTS,
    PREFIX,
    RESOURCE,
    _artifact,
    _authenticate,
    _discard,
    _queue,
    pytestmark,
)
from tests.patching import patch_package


def test_the_mechanism_is_named_rather_than_assumed():
    # Three quite different things hide behind the word "background", and an
    # operator reading a slow export needs to know which one they have.
    assert background.mechanism() in background.MECHANISMS
    with background.synchronous():
        assert background.mechanism() == "inline"


def test_synchronous_runs_the_work_before_spawn_returns():
    ran: list[str] = []
    with background.synchronous():
        used = background.spawn(lambda: ran.append("yes"), name="test")
    assert used == "inline"
    assert ran == ["yes"], "synchronous() has to finish the work, not schedule it"


def test_a_raising_callable_does_not_escape_spawn():
    # There is no caller left to catch anything by the time this runs, so the
    # contract is that `spawn` swallows and logs. A background mechanism that
    # let an exception out would take the greenlet with it.
    def boom() -> None:
        raise RuntimeError("no")

    with background.synchronous():
        assert background.spawn(boom, name="test") == "inline"


def test_write_to_counts_the_rows_it_wrote():
    columns = [writer.Column("a", "A"), writer.Column("b", "B")]
    rows = [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}, {"a": 3, "b": "z"}]
    buffer = io.BytesIO()

    written = writer.write_to(buffer, iter(rows), columns, fmt="csv")

    # The count is the file's, which is the whole reason it is returned rather
    # than taken from the query that produced the rows.
    assert written == 3
    body = buffer.getvalue().decode("utf-8-sig")
    assert list(csv.reader(io.StringIO(body)))[0] == ["A", "B"]
    assert len(list(csv.reader(io.StringIO(body)))) == 4


def test_write_to_produces_json_that_parses():
    columns = [writer.Column("a", "A")]
    buffer = io.BytesIO()
    writer.write_to(buffer, iter([{"a": None}, {"a": 2}]), columns, fmt="json")
    # `null` rather than `""`: a consumer parsing JSON should not have to guess
    # whether an empty string meant a missing value.
    assert json.loads(buffer.getvalue()) == [{"a": None}, {"a": 2}]


def test_write_to_produces_a_workbook_openpyxl_can_read():
    from openpyxl import load_workbook

    columns = [writer.Column("a", "A")]
    buffer = io.BytesIO()
    assert writer.write_to(buffer, iter([{"a": 7}]), columns, fmt="xlsx") == 1
    buffer.seek(0)
    sheet = load_workbook(buffer).active
    assert [cell.value for cell in next(sheet.iter_rows())] == ["A"]


def test_an_estimate_says_whether_it_streams_or_has_to_be_queued(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.post(
        f"{EXPORTS}/estimate", json={"resource_type": RESOURCE, "format": "csv"}, headers=headers
    )
    assert answer.status_code == 200
    body = answer.get_json()

    assert body["rows"] > 0, "the seed has no tickets"
    # The seeded dataset is far below the streaming ceiling, so a page should
    # offer the immediate download and not add a step.
    assert body["can_stream"] is True
    assert body["can_queue"] is True
    assert body["too_large"] is False
    assert body["streams_up_to"] == writer.MAX_ROWS


def test_an_estimate_counts_the_filtered_question_not_the_table(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    whole = client.post(
        f"{EXPORTS}/estimate", json={"resource_type": RESOURCE}, headers=headers
    ).get_json()
    narrowed = client.post(
        f"{EXPORTS}/estimate",
        json={"resource_type": RESOURCE, "filters": {"status": "OPEN"}},
        headers=headers,
    ).get_json()

    assert narrowed["rows"] < whole["rows"], "the filter did not reach the count"
    assert "status" in narrowed["description"]


def test_the_streaming_ceiling_the_estimate_reports_is_the_one_that_is_enforced(
    client, monkeypatch
):
    # The number a page prints and the number the API refuses at have to be the
    # same number, or the page is lying about the product's own limits.
    patch_package(monkeypatch, writer, "MAX_ROWS", 3)
    headers = _authenticate(monkeypatch)
    body = client.post(
        f"{EXPORTS}/estimate", json={"resource_type": RESOURCE, "format": "csv"}, headers=headers
    ).get_json()

    assert body["can_stream"] is False
    refused = client.post(
        f"{PREFIX}/api/explorer/export",
        json={"resource_type": RESOURCE, "format": "csv"},
        headers=headers,
    )
    assert refused.status_code == 400
    details = refused.get_json()["details"]
    assert details["maximum"] == 3
    # And the refusal points at the path that now exists.
    assert details["queue_instead"] is True


def test_a_queued_export_produces_a_real_file_with_a_real_row_count(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = _queue(client, headers)
    assert response.status_code == 201
    body = response.get_json()

    try:
        assert body["reference"].startswith("EXP-")
        assert body["status"] == "SUCCEEDED"
        assert body["rows"] > 0
        assert body["downloadable"] is True

        key, blob = _artifact(body["id"])
        assert key.startswith("exports/")
        # The count on the row is the count in the file. Not "about right":
        # equal, because one was derived from the other.
        lines = list(csv.reader(io.StringIO(blob.decode("utf-8-sig"))))
        assert len(lines) == body["rows"] + 1
        assert body["size_bytes"] == len(blob)
    finally:
        _discard(client, headers, body["id"])


def test_a_queued_export_is_the_same_question_as_the_download_would_have_been(
    client, monkeypatch
):
    # The claim the shared `explorer.Plan` exists for. An export that queued
    # *because* it was large must not be a wider query than the one on screen.
    headers = _authenticate(monkeypatch)
    response = _queue(
        client, headers, filters={"status": "OPEN"}, columns=["reference", "status"]
    )
    body = response.get_json()

    try:
        key, blob = _artifact(body["id"])
        rows = list(csv.DictReader(io.StringIO(blob.decode("utf-8-sig"))))
        assert rows, "the filtered export is empty, so it proves nothing"
        assert {row["Status"] for row in rows} == {"OPEN"}
        # And the columns are the ones asked for, in that order.
        assert list(rows[0]) == ["Reference", "Status"]
    finally:
        _discard(client, headers, body["id"])


def test_the_row_count_matches_what_the_same_statement_counts(client, monkeypatch):
    from src.core.query import count_of
    from src.services.records import explorer

    headers = _authenticate(monkeypatch)
    response = _queue(client, headers, filters={"status": "OPEN"})
    body = response.get_json()

    try:
        with session_scope() as session:
            plan = explorer.replan(
                {"resource_type": RESOURCE, "format": "csv", "filters": {"status": "OPEN"}}
            )
            counted = count_of(session, explorer.statement_of(plan))
        assert body["rows"] == counted
    finally:
        _discard(client, headers, body["id"])


def test_the_stored_plan_describes_itself_from_the_field_catalogue(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = _queue(client, headers, filters={"status": "OPEN"})
    body = response.get_json()

    try:
        # Re-derived on every read rather than saved as a sentence, so
        # relabelling a field cannot leave a stale description behind.
        assert "Tickets" in body["description"] or "ticket" in body["description"].lower()
        assert body["columns"], "the plan recorded no columns"
    finally:
        _discard(client, headers, body["id"])


def test_a_plan_naming_a_column_that_no_longer_exists_is_a_bad_request():
    from src.core.errors import ValidationError
    from src.services.records import explorer

    # Re-validated when it runs rather than trusted: a field can be removed
    # from a resource between queueing an export and producing it, and that has
    # to be a 400 and not a 500 inside a background job.
    with pytest.raises(ValidationError):
        explorer.replan({"resource_type": RESOURCE, "columns": ["a_field_nobody_declared"]})


def test_an_export_whose_query_has_gone_stale_still_reads_as_a_record(client, monkeypatch):
    from src.models.platform import BackgroundJob

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            row = session.get(BackgroundJob, body["id"])
            row.payload = {**(row.payload or {}), "columns": ["gone_away"]}

        # The row is still the record of what somebody asked for, so reading it
        # must not fail — it says the query cannot be read any more.
        again = client.get(f"{EXPORTS}/{body['id']}", headers=headers).get_json()
        assert "no longer exist" in again["description"]
    finally:
        _discard(client, headers, body["id"])


def test_the_reference_continues_from_the_highest_one(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    first = _queue(client, headers).get_json()
    second = _queue(client, headers).get_json()

    try:
        assert first["reference"] != second["reference"]
        assert int(second["reference"].removeprefix("EXP-")) == (
            int(first["reference"].removeprefix("EXP-")) + 1
        )
    finally:
        _discard(client, headers, first["id"])
        _discard(client, headers, second["id"])
