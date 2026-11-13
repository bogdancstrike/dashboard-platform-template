"""Exports that exist as things rather than as responses (§30). — downloading."""

from __future__ import annotations

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


def test_a_download_is_a_signed_url_to_the_bytes_that_were_stored(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        answer = client.get(f"{EXPORTS}/{body['id']}/download", headers=headers)
        assert answer.status_code == 200
        link = answer.get_json()

        assert link["url"], "no URL was signed"
        assert link["expires_in"] > 0, "a link that never expires is a permanent grant"
        assert link["rows"] == body["rows"]
        # The signature is over the object that exists, which is what makes the
        # link worth having.
        _, blob = _artifact(body["id"])
        assert link["size_bytes"] == len(blob)
    finally:
        _discard(client, headers, body["id"])


def test_a_download_before_the_file_exists_says_so_rather_than_404(client, monkeypatch):
    from src.models.platform import BackgroundJob

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            session.get(BackgroundJob, body["id"]).status = "RUNNING"

        answer = client.get(f"{EXPORTS}/{body['id']}/download", headers=headers)
        # 409, not 404: the export exists and is not ready, which is a
        # different thing from not existing and reads differently on a page.
        assert answer.status_code == 409
        assert answer.get_json()["details"]["status"] == "RUNNING"
    finally:
        with session_scope() as session:
            row = session.get(BackgroundJob, body["id"])
            if row is not None:
                row.status = "SUCCEEDED"
        _discard(client, headers, body["id"])


def test_an_artefact_missing_from_storage_is_reported_and_the_row_corrected(
    client, monkeypatch
):
    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()
    key, _ = _artifact(body["id"])

    # Removed behind the platform's back, which is what happens when somebody
    # empties a bucket. A signed URL to a missing object is a download that
    # fails with the wrong error.
    storage.for_config().delete(key)

    answer = client.get(f"{EXPORTS}/{body['id']}/download", headers=headers)
    assert answer.status_code == 404
    again = client.get(f"{EXPORTS}/{body['id']}", headers=headers).get_json()
    # And the row now agrees with storage rather than going on offering it.
    assert again["downloadable"] is False


def test_an_expired_export_is_refused_and_its_bytes_are_dropped(client, monkeypatch):
    from datetime import timedelta

    from src.models.platform import BackgroundJob

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()
    key, _ = _artifact(body["id"])

    with session_scope() as session:
        row = session.get(BackgroundJob, body["id"])
        row.finished_at = row.finished_at - timedelta(days=400)

    answer = client.get(f"{EXPORTS}/{body['id']}/download", headers=headers)
    assert answer.status_code == 409
    details = answer.get_json()["details"]
    assert details["expired"] is True
    assert details["retention_days"] > 0
    # Lazy expiry, done where the fact is discovered: there is no sweeper in
    # this stack, so the alternative is bytes that live forever.
    assert storage.for_config().stat(key) is None


def test_expiry_is_derived_so_changing_the_setting_changes_it(client, monkeypatch):
    from src.models.platform import BackgroundJob

    headers = _authenticate(monkeypatch)
    body = _queue(client, headers).get_json()

    try:
        with session_scope() as session:
            row = session.get(BackgroundJob, body["id"])
            close = service.expires_at(row, 1)
            far = service.expires_at(row, 30)
        # Stored as a column it would go on answering the number that applied
        # when it was written.
        assert far > close
    finally:
        _discard(client, headers, body["id"])


def test_the_listing_is_mine_and_only_mine(client, monkeypatch):
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    body = _queue(client, headers).get_json()

    try:
        mine = client.get(EXPORTS, headers=headers).get_json()
        assert body["id"] in [row["id"] for row in mine["items"]]

        other = _authenticate(monkeypatch, "manager", "manager")
        theirs = client.get(EXPORTS, headers=other).get_json()
        assert body["id"] not in [row["id"] for row in theirs["items"]]
    finally:
        headers = _authenticate(monkeypatch, "analyst", "analyst")
        _discard(client, headers, body["id"])


def test_an_administrator_cannot_download_somebody_elses_export(client, monkeypatch):
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    body = _queue(client, headers).get_json()

    try:
        admin = _authenticate(monkeypatch, "admin", "administrator")
        answer = client.get(f"{EXPORTS}/{body['id']}/download", headers=admin)
        # 404 rather than 403, deliberately: a "that is somebody else's" reply
        # is a way to confirm a reference exists. And an administrator who
        # needs the data can run the query in their own name, which leaves an
        # audit entry that a download of this row would not.
        assert answer.status_code == 404
        assert client.get(f"{EXPORTS}/{body['id']}", headers=admin).status_code == 404
    finally:
        headers = _authenticate(monkeypatch, "analyst", "analyst")
        _discard(client, headers, body["id"])


def test_a_role_without_the_export_privilege_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch, "user", "viewer")
    for method, url in (
        ("get", EXPORTS),
        ("get", f"{EXPORTS}/catalogue"),
    ):
        assert getattr(client, method)(url, headers=headers).status_code == 403
    assert client.post(EXPORTS, json={"resource_type": RESOURCE}, headers=headers).status_code == 403


def test_a_dataset_the_requester_cannot_read_cannot_be_exported(client, monkeypatch):
    # The export privilege is not a way around a dataset's own permission: the
    # plan is authorised against the resource before anything is queued.
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    answer = client.post(EXPORTS, json={"resource_type": "user"}, headers=headers)
    assert answer.status_code in (400, 403)


def test_the_catalogue_offers_only_datasets_the_reader_may_see(client, monkeypatch):
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    body = client.get(f"{EXPORTS}/catalogue", headers=headers).get_json()
    offered = {entry["key"] for entry in body["datasets"]}

    assert RESOURCE in offered
    from src.services.records import explorer

    with session_scope():
        for key, resource in explorer.resources().items():
            if key in offered:
                continue
            # Anything withheld is withheld because of its own permission, not
            # arbitrarily — a picker offering a dataset whose export 403s is a
            # picker that wastes somebody's time.
            assert resource.permission != "records.view", key
