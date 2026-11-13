"""Loading a spreadsheet somebody exported from something else (§29). — the error report."""

from __future__ import annotations

import csv
import io

from sqlalchemy import select

from src.core.db import session_scope
from src.services.transfer import imports as service
from tests.imports_support import (  # noqa: F401
    ENUM_BAD,
    ENUM_FIELD,
    IMPORTS,
    TARGET,
    _authenticate,
    _begin,
    _csv,
    _discard,
    _execute,
    _rows,
    pytestmark,
)
from tests.patching import patch_package


def test_the_problems_come_back_as_a_file_to_fix_in_the_spreadsheet(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rows = [*_rows(1), {"name": "Import Test Bad", "email": "x@example.test", "segment": ENUM_BAD}]
    body = _begin(client, headers, _csv(rows)).get_json()

    try:
        client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
            headers=headers,
        )
        answer = client.get(f"{IMPORTS}/{body['id']}/problems", headers=headers)
        assert answer.status_code == 200
        assert "text/csv" in answer.headers["Content-Type"]

        lines = list(csv.DictReader(io.StringIO(answer.get_data(as_text=True).lstrip("﻿"))))
        # The four things needed to find and fix one.
        assert set(lines[0]) == {"Line", "Column", "Value", "Problem"}
        assert lines[0]["Line"] == "3"
        assert lines[0]["Column"] == ENUM_FIELD
        assert lines[0]["Value"] == ENUM_BAD
    finally:
        _discard(client, headers, body["id"])


def test_an_import_with_nothing_wrong_has_no_report(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
            headers=headers,
        )
        # 404 rather than an empty file: a downloaded CSV with a header and no
        # rows reads as "the report is broken".
        assert client.get(f"{IMPORTS}/{body['id']}/problems", headers=headers).status_code == 404
    finally:
        _discard(client, headers, body["id"])


def test_the_listing_is_mine_and_only_mine(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        mine = client.get(IMPORTS, headers=headers).get_json()
        assert body["id"] in [row["id"] for row in mine["items"]]

        admin = _authenticate(monkeypatch, "admin", "administrator")
        theirs = client.get(IMPORTS, headers=admin).get_json()
        assert body["id"] not in [row["id"] for row in theirs["items"]]
    finally:
        headers = _authenticate(monkeypatch, "manager", "manager")
        _discard(client, headers, body["id"])


def test_an_administrator_cannot_read_somebody_elses_staged_file(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        admin = _authenticate(monkeypatch, "admin", "administrator")
        # A staged import holds the contents of a spreadsheet — names, emails,
        # whatever it had. 404 rather than 403, for the reason an export's
        # artefact is: the reply must not confirm the reference exists.
        assert client.get(f"{IMPORTS}/{body['id']}", headers=admin).status_code == 404
        assert client.post(f"{IMPORTS}/{body['id']}/execute", headers=admin).status_code == 404
    finally:
        headers = _authenticate(monkeypatch, "manager", "manager")
        _discard(client, headers, body["id"])


def test_a_role_without_the_import_privilege_is_refused(client, monkeypatch):
    # Narrower than `records.create` on purpose: creating one record is a form
    # somebody can see, importing five thousand is not.
    headers = _authenticate(monkeypatch, "operator", "operator")
    assert client.get(IMPORTS, headers=headers).status_code == 403
    assert client.get(f"{IMPORTS}/catalogue", headers=headers).status_code == 403
    assert _begin(client, headers, _csv(_rows(1))).status_code == 403


def test_only_datasets_that_can_be_created_are_offered(client, monkeypatch):
    from src.services.records import explorer

    headers = _authenticate(monkeypatch)
    catalogue = client.get(f"{IMPORTS}/catalogue", headers=headers).get_json()
    offered = {item["key"] for item in catalogue["targets"]}

    assert TARGET in offered
    for key, resource in explorer.resources().items():
        if resource.identity is None:
            # A picker offering a dataset whose create 400s wastes somebody's
            # time (§76).
            assert key not in offered


def test_a_dataset_that_cannot_be_created_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = _begin(client, headers, _csv(_rows(1)), target_entity="nothing-like-this")
    assert answer.status_code == 400
    assert "available" in answer.get_json()["details"]


def test_the_first_press_drops_the_staged_file_and_keeps_the_record(client, monkeypatch):
    from src.models.platform import ImportRun

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(2))).get_json()

    answer = client.delete(f"{IMPORTS}/{body['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["status"] == "CANCELLED"
    assert answer.get_json()["removed"] is False

    with session_scope() as session:
        row = session.get(ImportRun, body["id"])
        assert row is not None, "the record of the attempt survives the first press"
        # The copy of somebody's spreadsheet does not — that is the part that
        # may need to be gone now.
        assert row.staged_rows is None
        assert row.total_rows == 2

    _discard(client, headers, body["id"])


def test_the_second_press_removes_the_record(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    assert client.delete(f"{IMPORTS}/{body['id']}", headers=headers).get_json()[
        "removed"
    ] is False
    second = client.delete(f"{IMPORTS}/{body['id']}", headers=headers)
    assert second.status_code == 200
    assert second.get_json()["removed"] is True
    assert client.get(f"{IMPORTS}/{body['id']}", headers=headers).status_code == 404


def test_the_removed_record_leaves_its_history_behind(client, monkeypatch):
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()
    _discard(client, headers, body["id"])

    with session_scope() as session:
        actions = set(
            session.scalars(
                select(AuditLog.action).where(AuditLog.resource_id == body["id"])
            ).all()
        )
    # The reason removing the row is defensible: the history is in the one
    # place the person who made the run cannot edit it.
    assert {"import.begin", "import.discard", "import.remove"} <= actions


def test_a_completed_import_can_be_removed_but_not_re_run(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )
    _execute(client, headers, body["id"])

    # Its file is already gone, so the one press left removes the record —
    # there is nothing else to take away.
    answer = client.delete(f"{IMPORTS}/{body['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["removed"] is True
    assert client.post(f"{IMPORTS}/{body['id']}/execute", headers=headers).status_code == 404


def test_a_running_import_cannot_be_discarded(client, monkeypatch):
    from src.models.platform import ImportRun

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        with session_scope() as session:
            session.get(ImportRun, body["id"]).status = "RUNNING"
        answer = client.delete(f"{IMPORTS}/{body['id']}", headers=headers)
        # Not while it is writing: removing the row mid-transaction would lose
        # the only record of what is happening.
        assert answer.status_code == 409
    finally:
        with session_scope() as session:
            row = session.get(ImportRun, body["id"])
            if row is not None:
                row.status = "DRAFT"
        _discard(client, headers, body["id"])


def test_only_so_many_may_be_open_at_once(client, monkeypatch):
    patch_package(monkeypatch, service, "MAX_OPEN_PER_PERSON", 1)
    headers = _authenticate(monkeypatch)
    first = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        refused = _begin(client, headers, _csv(_rows(1)))
        assert refused.status_code == 409
        # A draft holds a whole file, so the limit is about held data as much
        # as about rows of a table.
        assert refused.get_json()["details"]["maximum"] == 1
    finally:
        _discard(client, headers, first["id"])


def test_a_discarded_import_frees_its_slot(client, monkeypatch):
    patch_package(monkeypatch, service, "MAX_OPEN_PER_PERSON", 1)
    headers = _authenticate(monkeypatch)
    first = _begin(client, headers, _csv(_rows(1))).get_json()
    _discard(client, headers, first["id"])

    second = _begin(client, headers, _csv(_rows(1)))
    assert second.status_code == 201
    _discard(client, headers, second.get_json()["id"])
