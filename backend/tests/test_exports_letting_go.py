"""Exports that exist as things rather than as responses (§30). — letting go."""

from __future__ import annotations

from sqlalchemy import select

from src.core import storage
from src.core.db import session_scope
from src.services.transfer import exports as service
from tests.exports_support import (  # noqa: F401
    EXPORTS,
    RESOURCE,
    _artifact,
    _authenticate,
    _discard,
    _queue,
    pytestmark,
)
from tests.patching import patch_package


def test_the_first_press_drops_the_file_and_keeps_the_record(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()
    key, _ = _artifact(body["id"])

    answer = client.delete(f"{EXPORTS}/{body['id']}", headers=headers)
    assert answer.status_code == 200
    after = answer.get_json()

    assert storage.for_config().stat(key) is None, "the bytes are still there"
    assert after["downloadable"] is False
    assert after["removed"] is False
    # The row survives the file, because the two acts are different sizes: one
    # takes a copy of production data out of storage.
    assert client.get(f"{EXPORTS}/{body['id']}", headers=headers).status_code == 200
    assert after["rows"] == body["rows"]


def test_a_discarded_export_keeps_the_counts_as_history(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    after = client.delete(f"{EXPORTS}/{body['id']}", headers=headers).get_json()
    try:
        # "1,284 rows, 88 KB" is what the record is *for*, so the file going
        # must not take it. `has_file` is the separate question, and the one
        # that decides what a second press does.
        assert after["rows"] == body["rows"]
        assert after["size_bytes"] == body["size_bytes"]
        assert after["has_file"] is False
        assert after["downloadable"] is False
    finally:
        _discard(client, headers, body["id"])


def test_the_second_press_removes_the_record(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    assert client.delete(f"{EXPORTS}/{body['id']}", headers=headers).get_json()[
        "removed"
    ] is False
    second = client.delete(f"{EXPORTS}/{body['id']}", headers=headers)
    assert second.status_code == 200
    assert second.get_json()["removed"] is True

    # Gone from the list, which is what a person asked for. Keeping every
    # discarded export forever answers nothing about one person's own requests.
    assert client.get(f"{EXPORTS}/{body['id']}", headers=headers).status_code == 404


def test_the_record_that_is_removed_leaves_its_history_behind(client, monkeypatch):
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()
    client.delete(f"{EXPORTS}/{body['id']}", headers=headers)
    client.delete(f"{EXPORTS}/{body['id']}", headers=headers)

    with session_scope() as session:
        actions = set(
            session.scalars(
                select(AuditLog.action).where(AuditLog.resource_id == body["id"])
            ).all()
        )
    # The history the row used to carry, in the one place its requester cannot
    # edit it — which is the reason removing the row is defensible at all.
    assert {"export.queue", "export.forget", "export.remove"} <= actions


def test_forget_is_refused_while_the_export_is_still_being_produced(client, monkeypatch):
    from src.models.platform import BackgroundJob

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            session.get(BackgroundJob, body["id"]).status = "RUNNING"
        answer = client.delete(f"{EXPORTS}/{body['id']}", headers=headers)
        assert answer.status_code == 409
    finally:
        with session_scope() as session:
            row = session.get(BackgroundJob, body["id"])
            if row is not None:
                row.status = "SUCCEEDED"
        _discard(client, headers, body["id"])


def test_a_third_press_has_nothing_left_to_find(client, monkeypatch):
    # Not idempotent, and it should not be: after the second press the export
    # is gone, and a 200 would suggest there was still something there.
    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()
    assert client.delete(f"{EXPORTS}/{body['id']}", headers=headers).status_code == 200
    assert client.delete(f"{EXPORTS}/{body['id']}", headers=headers).status_code == 200
    assert client.delete(f"{EXPORTS}/{body['id']}", headers=headers).status_code == 404


def test_a_failure_is_recorded_on_the_row_rather_than_lost(client, monkeypatch):
    def explode(*_args, **_kwargs):
        raise RuntimeError("the bucket said no")

    patch_package(monkeypatch, service, "produce", explode)
    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    # Nothing above the job is still running when it fails, so the row is the
    # only place the reason can end up.
    again = client.get(f"{EXPORTS}/{body['id']}", headers=headers).get_json()
    assert again["status"] == "FAILED"
    assert "the bucket said no" in (again["error_message"] or "")
    assert again["downloadable"] is False
    assert any("failed" in line.get("message", "") for line in again["log_lines"])


def test_a_failed_export_offers_no_download(client, monkeypatch):
    patch_package(
        monkeypatch, service, "produce", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("no"))
    )
    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    answer = client.get(f"{EXPORTS}/{body['id']}/download", headers=headers)
    assert answer.status_code == 409
    assert answer.get_json()["details"]["status"] == "FAILED"


def test_queueing_and_downloading_are_both_audited(client, monkeypatch):
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        client.get(f"{EXPORTS}/{body['id']}/download", headers=headers)
        with session_scope() as session:
            actions = set(
                session.scalars(
                    select(AuditLog.action).where(AuditLog.resource_id == body["id"])
                ).all()
            )
        # Two separate facts: somebody asked, and somebody fetched. Only the
        # second is the moment a copy of the data left.
        assert {"export.queue", "export.download"} <= actions
    finally:
        _discard(client, headers, body["id"])


def test_the_audit_row_records_the_question_and_not_the_rows(client, monkeypatch):
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            entry = session.scalar(
                select(AuditLog).where(
                    AuditLog.resource_id == body["id"], AuditLog.action == "export.queue"
                )
            )
            after = entry.state_after or {}
        assert after["resource"] == RESOURCE
        assert after["rows"] == body["rows"] or after["rows"] >= 0
        # An audit row carrying the exported values would be a second copy of
        # the data the export already is.
        assert "items" not in after and "values" not in after
    finally:
        _discard(client, headers, body["id"])
