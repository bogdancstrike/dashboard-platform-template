"""The file manager's rules: listing filters, unfinished uploads, folders.

`test_files` covers uploading and downloading through storage. These pin what
the page asks of the API around that — the folder/kind/name filters, a file
whose bytes have not arrived (409, not a broken link), renames and moves that
are refused, and folder names that cannot be made.
"""

from __future__ import annotations

import uuid

import pytest

from src.services import files as service
from tests.personas import PREFIX, as_each

FILES = f"{PREFIX}/api/files"
FOLDERS = f"{PREFIX}/api/files/folders"

pytestmark = pytest.mark.database


def test_the_listing_filters_by_folder_kind_and_name(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    for query in ({"folder_id": "unfiled"}, {"q": "a", "kind": "DOCUMENT"}, {"folder_id": str(uuid.uuid4())}):
        response = client.get(FILES, query_string=query, headers=admin)
        assert response.status_code == 200, (query, response.get_json())
    unfiled = client.get(FILES, query_string={"folder_id": "unfiled"}, headers=admin).get_json()
    assert all(item.get("folder_id") in (None, "") for item in unfiled["items"])
    docs = client.get(FILES, query_string={"kind": "DOCUMENT"}, headers=admin).get_json()
    assert all(item["kind"] == "DOCUMENT" for item in docs["items"])
    assert client.get(FILES, query_string={"folder_id": "nope"}, headers=admin).status_code == 400


def test_an_upload_that_has_not_arrived_cannot_be_opened_or_misnamed(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    assert client.post(FILES, json=["x"], headers=admin).status_code == 400
    assert client.post(FILES, json={"name": "  ", "size_bytes": 3}, headers=admin).status_code == 400
    begun = client.post(FILES, json={"name": "probe.pdf", "size_bytes": 12, "mime_type": "application/pdf"},
                        headers=admin)
    assert begun.status_code in (200, 201), begun.get_json()
    file_id = (begun.get_json().get("file") or begun.get_json())["id"]

    pending = client.get(f"{FILES}/{file_id}", headers=admin)
    assert pending.status_code == 409 and "still uploading" in pending.get_json()["message"]
    assert client.put(f"{FILES}/{file_id}", json={"name": " "}, headers=admin).status_code == 400
    assert client.put(f"{FILES}/{file_id}", json={"folder_id": str(uuid.uuid4())}, headers=admin).status_code == 404
    moved = client.put(f"{FILES}/{file_id}", json={"name": "renamed.pdf", "folder_id": "unfiled"}, headers=admin)
    assert moved.status_code == 200 and moved.get_json()["name"] == "renamed.pdf"
    assert client.get(f"{FILES}/{uuid.uuid4()}", headers=admin).status_code == 404


def test_a_folder_name_has_to_be_a_new_single_segment(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    name = f"Probe {uuid.uuid4().hex[:6]}"
    for bad, status in (({"name": " "}, 400), ({"name": "a/b"}, 400),
                        ({"name": "x", "parent_id": str(uuid.uuid4())}, 404)):
        assert client.post(FOLDERS, json=bad, headers=admin).status_code == status, bad
    made = client.post(FOLDERS, json={"name": name}, headers=admin)
    assert made.status_code == 201, made.get_json()
    child = client.post(FOLDERS, json={"name": "Inside", "parent_id": made.get_json()["id"]}, headers=admin)
    assert child.status_code == 201 and child.get_json()["path"].endswith(f"{name}/Inside")
    again = client.post(FOLDERS, json={"name": name}, headers=admin)
    assert again.status_code == 409 and "already there" in again.get_json()["message"]
    assert client.delete(f"{FOLDERS}/{uuid.uuid4()}", headers=admin).status_code == 404


def test_a_files_kind_comes_from_its_extension():
    assert service._kind_for("zip") == "ARCHIVE"
    assert service._kind_for("yaml") == "DATA"
    assert service._kind_for("weird") == "OTHER"
