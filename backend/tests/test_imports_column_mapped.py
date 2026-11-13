"""Loading a spreadsheet somebody exported from something else (§29). — column mapped."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from tests.imports_support import (  # noqa: F401
    ENUM_BAD,
    IMPORTS,
    _authenticate,
    _begin,
    _csv,
    _discard,
    _execute,
    _rows,
    pytestmark,
)


def test_a_column_mapped_to_nothing_is_ignored_rather_than_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv([{"name": "Import Test", "legacy": "x"}])).get_json()

    try:
        mapped = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "legacy": ""}},
            headers=headers,
        ).get_json()
        # A deliberately ignored column is a normal answer, not an omission.
        assert mapped["column_mapping"] == {"name": "name"}
    finally:
        _discard(client, headers, body["id"])


def test_remapping_changes_which_rows_are_wrong(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rows = [{"name": "Import Test Remap", "when": "not-a-date"}]
    body = _begin(client, headers, _csv(rows)).get_json()

    try:
        # Mapped onto a date field: the value is wrong.
        bad = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "when": "last_contact_at"}},
            headers=headers,
        ).get_json()
        assert bad["invalid_rows"] == 1

        # Unmapped: the same file, and nothing wrong with it.
        good = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name"}},
            headers=headers,
        ).get_json()
        assert good["invalid_rows"] == 0
        assert good["valid_rows"] == 1
    finally:
        _discard(client, headers, body["id"])


def test_the_preview_carries_the_line_number_from_the_file(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(3))).get_json()

    try:
        preview = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()["preview"]
        # Row 1 is the header, so the first data row is line 2 — which is what
        # somebody needs to find it in the spreadsheet.
        assert [entry["line"] for entry in preview] == [2, 3, 4]
        assert preview[0]["source"]["name"] == "Import Test Customer 1"
    finally:
        _discard(client, headers, body["id"])


def test_an_import_creates_the_records_it_previewed(client, monkeypatch):
    from src.models.business import Customer

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(3))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )

    answer = _execute(client, headers, body["id"])
    assert answer.status_code == 202, answer.get_json()

    done = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()
    assert done["status"] == "COMPLETED"
    assert done["imported_rows"] == 3

    with session_scope() as session:
        made = session.scalars(
            select(Customer).where(Customer.name.like("Import Test Customer %"))
        ).all()
        assert len(made) == 3
        # Named by the server, as every create is — `customer` calls its
        # identifier `code`, which is why the resource declares the field
        # rather than the writer assuming one. A file does not get to choose
        # it, and none of these rows carried one.
        assert all(row.code.startswith("CUS-") for row in made)
        assert len({row.code for row in made}) == 3


def test_a_failure_part_way_leaves_no_records(client, monkeypatch):
    from src.models.business import Customer
    from src.services.records import writes as record_writes

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(4))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )

    original = record_writes.create_many
    state = {"calls": 0}

    def explode(session, resource_type, payloads, *, principal):
        # Half the rows inserted, then a failure — the shape that would leave a
        # partial import behind if the transaction were not the boundary.
        state["calls"] += 1
        original(session, resource_type, payloads[:2], principal=principal)
        raise RuntimeError("the third row broke something")

    monkeypatch.setattr(record_writes, "create_many", explode)
    _execute(client, headers, body["id"])

    failed = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()
    assert state["calls"] == 1
    assert failed["status"] == "FAILED"
    assert failed["imported_rows"] == 0
    assert any("Nothing was imported" in item["message"] for item in failed["errors"])

    with session_scope() as session:
        # The two that were inserted are gone: half an import is what makes
        # somebody load the same file twice.
        assert (
            session.scalars(
                select(Customer).where(Customer.name.like("Import Test Customer %"))
            ).all()
            == []
        )


def test_the_invalid_rows_are_left_out_and_the_valid_ones_land(client, monkeypatch):
    from src.models.business import Customer

    headers = _authenticate(monkeypatch)
    rows = [
        *_rows(2),
        {"name": "Import Test Bad", "email": "x@example.test", "segment": ENUM_BAD},
    ]
    body = _begin(client, headers, _csv(rows)).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )

    _execute(client, headers, body["id"])
    done = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()

    # All-or-nothing applies to the *valid* rows: the bad one was reported at
    # the preview, which is the step that exists so it can be.
    assert done["status"] == "COMPLETED"
    assert done["imported_rows"] == 2
    with session_scope() as session:
        names = {
            row.name
            for row in session.scalars(
                select(Customer).where(Customer.name.like("Import Test %"))
            )
        }
    assert "Import Test Bad" not in names


def test_the_staged_file_is_dropped_once_it_has_been_used(client, monkeypatch):
    from src.models.platform import ImportRun

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )
    _execute(client, headers, body["id"])

    with session_scope() as session:
        row = session.get(ImportRun, body["id"])
        # It is a copy of somebody's spreadsheet, and holding it after the
        # records exist would be holding the data twice for no reason.
        assert row.staged_rows is None


def test_an_import_cannot_be_run_twice(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )
    _execute(client, headers, body["id"])

    again = client.post(f"{IMPORTS}/{body['id']}/execute", headers=headers)
    assert again.status_code == 409
    assert "already been imported" in again.get_json()["message"]


def test_an_unvalidated_import_is_refused_with_the_reason(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv([{"segment": "SMB"}])).get_json()

    try:
        answer = client.post(f"{IMPORTS}/{body['id']}/execute", headers=headers)
        assert answer.status_code == 409
        # Names the fields, because "not ready" leaves somebody to guess which
        # of eleven columns they have not mapped (§76).
        assert answer.get_json()["details"]["unmapped_required"]
    finally:
        _discard(client, headers, body["id"])


def test_a_file_with_no_valid_row_says_so_rather_than_running(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rows = [{"name": "", "email": "", "segment": ""}]
    body = _begin(client, headers, _csv(rows)).get_json()

    try:
        client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
            headers=headers,
        )
        answer = client.post(f"{IMPORTS}/{body['id']}/execute", headers=headers)
        assert answer.status_code == 409
        assert "nothing to import" in answer.get_json()["message"]
    finally:
        _discard(client, headers, body["id"])
