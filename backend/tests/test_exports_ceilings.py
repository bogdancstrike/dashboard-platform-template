"""Exports that exist as things rather than as responses (§30). — the ceilings."""

from __future__ import annotations

from sqlalchemy import select

from src.core import background
from src.core import export as writer
from src.core.clock import now
from src.core.db import session_scope
from src.services.transfer import exports as service
from tests.exports_support import (  # noqa: F401
    EXPORTS,
    RESOURCE,
    _authenticate,
    _discard,
    _queue,
    pytestmark,
)
from tests.patching import patch_package


def test_above_the_installations_ceiling_it_is_refused_with_the_number(client, monkeypatch):
    patch_package(monkeypatch, service, "DEFAULT_MAX_ROWS", 2)
    patch_package(monkeypatch, service, "max_rows", lambda _session: 2)
    headers = _authenticate(monkeypatch)

    refused = client.post(EXPORTS, json={"resource_type": RESOURCE}, headers=headers)
    assert refused.status_code == 400
    details = refused.get_json()["details"]
    assert details["maximum"] == 2
    # Named, so an administrator knows which row to edit rather than being told
    # to "narrow the query" with no other option.
    assert details["setting"] == "limits.max_export_rows"


def test_the_ceiling_comes_from_the_settings_table(client, monkeypatch):
    from src.models.platform import SystemSetting

    headers = _authenticate(monkeypatch)
    with session_scope() as session:
        row = session.scalar(
            select(SystemSetting).where(SystemSetting.key == "limits.max_export_rows")
        )
        assert row is not None, "run `make seed-settings`; the setting is not there"
        stored = (row.value or {}).get("value")

    body = client.get(f"{EXPORTS}/catalogue", headers=headers).get_json()
    assert body["max_rows"] == stored


def test_the_spreadsheet_ceiling_is_not_raised_by_the_setting(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = client.get(f"{EXPORTS}/catalogue", headers=headers).get_json()
    formats = {entry["key"]: entry for entry in body["formats"]}

    # A zip container has to be finished before it can be sent, which is a
    # property of the format and not of the installation.
    assert formats["xlsx"]["maximum"] <= writer.MAX_XLSX_ROWS
    assert formats["csv"]["maximum"] == body["max_rows"]


def test_a_pending_export_that_is_too_old_reads_as_stalled(client, monkeypatch):
    from datetime import timedelta

    from src.models.platform import BackgroundJob

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            row = session.get(BackgroundJob, body["id"])
            row.status = "QUEUED"
            row.started_at = None
            # Backdated, and put back in the `finally`: the conftest sweep
            # decides what a test created by comparing `created_at` against
            # the instant the test began, so a row moved into the past is a row
            # that leaks into the demo database. Two of them did.
            row.created_at = row.created_at - timedelta(hours=3)
            assert service.stalled(row) is True

        # `core/background` loses in-flight work when the process restarts, so
        # a QUEUED row nothing will ever pick up is a state this platform
        # genuinely produces. A spinner that never stops is the wrong answer.
        again = client.get(f"{EXPORTS}/{body['id']}", headers=headers).get_json()
        assert again["stalled"] is True
        assert again["downloadable"] is False
    finally:
        with session_scope() as session:
            row = session.get(BackgroundJob, body["id"])
            if row is not None:
                row.status = "SUCCEEDED"
                row.created_at = now()
        _discard(client, headers, body["id"])


def test_a_stalled_export_does_not_hold_a_slot_forever(client, monkeypatch):
    from datetime import timedelta

    from src.models.platform import BackgroundJob

    patch_package(monkeypatch, service, "MAX_PENDING_PER_PERSON", 1)
    headers = _authenticate(monkeypatch)
    first = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            row = session.get(BackgroundJob, first["id"])
            row.status = "QUEUED"
            row.started_at = None
            # Put back in the `finally` — see the note in the test above.
            row.created_at = row.created_at - timedelta(hours=3)

        # Three of these and a limit of three would mean the button never
        # worked again, which is what the seeded queue's pending exports would
        # otherwise do on a fresh installation.
        second = _queue(client, headers)
        assert second.status_code == 201, second.get_json()
        _discard(client, headers, second.get_json()["id"])
    finally:
        with session_scope() as session:
            row = session.get(BackgroundJob, first["id"])
            if row is not None:
                row.status = "SUCCEEDED"
                row.created_at = now()
        _discard(client, headers, first["id"])


def test_a_fresh_pending_export_does_hold_one(client, monkeypatch):
    from src.models.platform import BackgroundJob

    patch_package(monkeypatch, service, "MAX_PENDING_PER_PERSON", 1)
    headers = _authenticate(monkeypatch)
    first = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            session.get(BackgroundJob, first["id"]).status = "RUNNING"

        refused = client.post(EXPORTS, json={"resource_type": RESOURCE}, headers=headers)
        assert refused.status_code == 409
        details = refused.get_json()["details"]
        assert details["maximum"] == 1
        # Named, so somebody can go and look at the one that is blocking them
        # rather than being told a number.
        assert first["reference"] in details["references"]
    finally:
        with session_scope() as session:
            row = session.get(BackgroundJob, first["id"])
            if row is not None:
                row.status = "SUCCEEDED"
        _discard(client, headers, first["id"])


def test_asking_again_makes_a_new_export_and_leaves_the_old_one_alone(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    first = _queue(client, headers).get_json()

    with background.synchronous():
        answer = client.post(f"{EXPORTS}/{first['id']}/again", headers=headers)
    assert answer.status_code == 201
    second = answer.get_json()

    try:
        # A new row, not a second attempt at the old one: the rows have moved on
        # since the first was asked for, and a file whose reference says one
        # moment and whose contents say another is worse than no file.
        assert second["id"] != first["id"]
        assert second["reference"] != first["reference"]
        assert second["attempt"] == 1
        # And the original is untouched, artefact included.
        untouched = client.get(f"{EXPORTS}/{first['id']}", headers=headers).get_json()
        assert untouched["downloadable"] is True
        assert untouched["reference"] == first["reference"]
    finally:
        _discard(client, headers, first["id"])
        _discard(client, headers, second["id"])


def test_asking_again_asks_the_same_question(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    first = _queue(
        client, headers, filters={"status": "OPEN"}, columns=["reference", "status"]
    ).get_json()

    with background.synchronous():
        second = client.post(f"{EXPORTS}/{first['id']}/again", headers=headers).get_json()

    try:
        assert second["columns"] == first["columns"]
        assert second["description"] == first["description"]
    finally:
        _discard(client, headers, first["id"])
        _discard(client, headers, second["id"])


def test_asking_again_on_somebody_elses_export_is_not_offered(client, monkeypatch):
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    body = _queue(client, headers).get_json()

    try:
        admin = _authenticate(monkeypatch, "admin", "administrator")
        assert client.post(f"{EXPORTS}/{body['id']}/again", headers=admin).status_code == 404
    finally:
        headers = _authenticate(monkeypatch, "analyst", "analyst")
        _discard(client, headers, body["id"])


def test_asking_again_on_a_stale_question_is_refused_with_the_reason(client, monkeypatch):
    from src.models.platform import BackgroundJob

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            row = session.get(BackgroundJob, body["id"])
            row.payload = {**(row.payload or {}), "columns": ["gone_away"]}

        # Refused through the ordinary validation rather than accepted and
        # failed inside a background job, which is where it used to be found.
        answer = client.post(f"{EXPORTS}/{body['id']}/again", headers=headers)
        assert answer.status_code == 400
        assert "gone_away" in str(answer.get_json())
    finally:
        _discard(client, headers, body["id"])
