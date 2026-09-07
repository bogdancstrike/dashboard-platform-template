"""The file manager, end to end against real object storage (§20).

The claim that matters is the one a unit test cannot make: **the bytes never
pass through the API**. So these tests do what a browser does — ask for a
presigned URL, PUT the bytes at object storage directly, then tell the API it
is done — and assert that the API checked rather than believed.

Skipped without a reachable store, like every other test that needs a
dependency: the suite has to run on a laptop with nothing installed.
"""

from __future__ import annotations

import io
import urllib.error
import urllib.request
from uuid import uuid4

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
FILES = f"{PREFIX}/api/files"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"files-{username}"),
    )
    return {"Authorization": f"Bearer files-{username}"}


def _put(url: str, body: bytes, content_type: str) -> int:
    """Upload the way a browser does: straight at storage, past this process."""
    request = urllib.request.Request(
        url, method="PUT", data=body, headers={"Content-Type": content_type}
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)


@pytest.fixture()
def uploaded(client, monkeypatch, has_database):
    """A file this test owns, uploaded for real and removed afterwards."""
    if not has_database:
        pytest.skip("needs PostgreSQL")

    headers = _authenticate(monkeypatch)
    name = f"probe-{uuid4().hex[:8]}.md"
    body = f"# {name}\n\nUploaded by the test suite.\n".encode()

    begun = client.post(
        FILES, json={"name": name, "size_bytes": len(body), "mime_type": "text/markdown"},
        headers=headers,
    )
    assert begun.status_code == 201, begun.get_json()
    opening = begun.get_json()

    status = _put(opening["upload"]["url"], body, "text/markdown")
    if status >= 400:
        pytest.skip(f"object storage refused the upload ({status}); is MinIO running?")

    confirmed = client.post(
        f"{FILES}/{opening['file']['id']}/confirm", headers=_authenticate(monkeypatch)
    )
    assert confirmed.status_code == 200, confirmed.get_json()

    yield confirmed.get_json(), body, headers

    client.delete(f"{FILES}/{opening['file']['id']}", headers=_authenticate(monkeypatch))


def test_files_need_a_bearer_token(client):
    assert client.get(f"{FILES}/tree").status_code == 401
    assert client.get(FILES).status_code == 401


@pytest.mark.database
def test_the_tree_says_which_store_is_answering(client, monkeypatch):
    """The local fallback streams every byte through this process, which is a
    trade nobody should make in a deployment without knowing it."""
    body = client.get(f"{FILES}/tree", headers=_authenticate(monkeypatch)).get_json()

    assert body["store"] in ("object", "local")
    assert body["max_upload_bytes"] > 0
    assert "exe" in body["refused_extensions"]
    assert body["folders"], "the seed builds a folder tree"
    # Counts come from one GROUP BY rather than from the denormalised columns,
    # which are a second description of the same thing.
    assert all("file_count" in folder for folder in body["folders"])


@pytest.mark.database
def test_an_upload_is_two_phases_and_the_second_one_checks(client, monkeypatch):
    """The API cannot see a presigned upload, so it verifies with `stat`.

    A confirmation that trusts the caller produces a file list full of rows
    with nothing behind them — worse than an upload that visibly failed.
    """
    headers = _authenticate(monkeypatch)
    begun = client.post(
        FILES, json={"name": f"never-{uuid4().hex[:6]}.txt", "size_bytes": 10},
        headers=headers,
    ).get_json()

    assert begun["file"]["status"] == "UPLOADING"
    assert begun["upload"]["method"] == "PUT"
    assert begun["upload"]["expires_in"] > 0

    # Confirm without ever uploading: refused, and the file stays visible as
    # what it is rather than becoming a lie.
    refused = client.post(f"{FILES}/{begun['file']['id']}/confirm", headers=headers)
    assert refused.status_code == 409
    assert "retried" in refused.get_json()["message"]

    client.delete(f"{FILES}/{begun['file']['id']}", headers=headers)


@pytest.mark.database
def test_the_key_is_generated_and_carries_nothing_the_client_chose(client, monkeypatch):
    """A key built from a name is a key somebody can aim at another object."""
    headers = _authenticate(monkeypatch)
    begun = client.post(
        FILES,
        json={"name": "../../etc/passwd.txt", "size_bytes": 10},
        headers=headers,
    ).get_json()

    # The name is kept as metadata; the key is a UUID under a generated path.
    assert begun["file"]["name"] == "../../etc/passwd.txt"
    assert ".." not in begun["upload"]["url"]
    assert "passwd" not in begun["upload"]["url"]

    client.delete(f"{FILES}/{begun['file']['id']}", headers=headers)


@pytest.mark.database
def test_a_refused_extension_never_gets_a_url(client, monkeypatch):
    response = client.post(
        FILES, json={"name": "payload.sh", "size_bytes": 10}, headers=_authenticate(monkeypatch)
    )
    assert response.status_code == 400
    assert response.get_json()["details"]["extension"] == "sh"


@pytest.mark.database
def test_the_bytes_go_to_storage_and_come_back_unchanged(client, uploaded):
    """The whole point: the browser uploads past the API and downloads past it."""
    stored, body, headers = uploaded

    assert stored["status"] == "READY"
    # The size the *store* reported, not the number the client claimed.
    assert stored["size_bytes"] == len(body)
    assert stored["checksum"]

    signed = client.get(f"{FILES}/{stored['id']}", headers=headers).get_json()
    assert signed["download"]["method"] == "GET"

    with urllib.request.urlopen(signed["download"]["url"], timeout=10) as response:
        assert response.read() == body


@pytest.mark.database
def test_asking_to_download_is_recorded(client, uploaded):
    stored, _body, headers = uploaded
    before = stored["download_count"]

    after = client.get(f"{FILES}/{stored['id']}", headers=headers).get_json()
    assert after["file"]["download_count"] == before + 1


@pytest.mark.database
def test_renaming_and_moving_leaves_the_object_where_it_is(client, uploaded, monkeypatch):
    """A storage key is an address, not a path. Moving bytes to make a tree
    look tidy is a copy and a delete for something no reader ever sees."""
    stored, body, headers = uploaded

    folder = client.post(
        f"{FILES}/folders", json={"name": f"probe-{uuid4().hex[:6]}"}, headers=headers
    ).get_json()

    try:
        moved = client.put(
            f"{FILES}/{stored['id']}",
            json={"name": "renamed.md", "folder_id": folder["id"]},
            headers=headers,
        ).get_json()
        assert moved["name"] == "renamed.md"
        assert moved["folder_id"] == folder["id"]

        # And the bytes are still there, at the address they were written to.
        signed = client.get(f"{FILES}/{stored['id']}", headers=headers).get_json()
        with urllib.request.urlopen(signed["download"]["url"], timeout=10) as response:
            assert response.read() == body
    finally:
        client.put(f"{FILES}/{stored['id']}", json={"folder_id": None}, headers=headers)
        client.delete(f"{FILES}/folders/{folder['id']}", headers=headers)


@pytest.mark.database
def test_deleting_a_file_removes_the_object_too(client, monkeypatch):
    """A row without its bytes is a file somebody will try to download; bytes
    without a row are storage nobody can ever reclaim."""
    from src.core import storage

    headers = _authenticate(monkeypatch)
    body = b"# gone\n"
    begun = client.post(
        FILES, json={"name": f"gone-{uuid4().hex[:6]}.md", "size_bytes": len(body)},
        headers=headers,
    ).get_json()

    if _put(begun["upload"]["url"], body, "text/markdown") >= 400:
        pytest.skip("object storage refused the upload; is MinIO running?")
    client.post(f"{FILES}/{begun['file']['id']}/confirm", headers=headers)

    key = None
    with __import__("src.core.db", fromlist=["session_scope"]).session_scope() as session:
        from src.models.content import FileObject

        row = session.get(FileObject, begun["file"]["id"])
        key = row.storage_key

    assert storage.for_config().stat(key) is not None
    client.delete(f"{FILES}/{begun['file']['id']}", headers=headers)
    assert storage.for_config().stat(key) is None


@pytest.mark.database
def test_a_folder_is_only_removed_when_it_is_empty(client, uploaded, monkeypatch):
    """A recursive delete of a tree of files is a mistake somebody makes once
    and cannot undo."""
    stored, _body, headers = uploaded
    folder = client.post(
        f"{FILES}/folders", json={"name": f"busy-{uuid4().hex[:6]}"}, headers=headers
    ).get_json()

    try:
        client.put(f"{FILES}/{stored['id']}", json={"folder_id": folder["id"]}, headers=headers)
        refused = client.delete(f"{FILES}/folders/{folder['id']}", headers=headers)
        assert refused.status_code == 409
        assert refused.get_json()["details"]["files"] == 1
    finally:
        client.put(f"{FILES}/{stored['id']}", json={"folder_id": None}, headers=headers)
        assert client.delete(f"{FILES}/folders/{folder['id']}", headers=headers).status_code == 200


@pytest.mark.database
def test_reading_files_does_not_carry_the_right_to_change_them(client, monkeypatch):
    """A viewer reads the library and is told which permission uploading needs."""
    headers = _authenticate(monkeypatch, "user", "viewer")

    tree = client.get(f"{FILES}/tree", headers=headers)
    assert tree.status_code == 200
    assert tree.get_json()["can_manage"] is False

    refused = client.post(FILES, json={"name": "mine.txt", "size_bytes": 4}, headers=headers)
    assert refused.status_code == 403
    assert "files.manage" in str(refused.get_json())
