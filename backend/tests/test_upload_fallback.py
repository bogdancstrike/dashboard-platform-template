"""Uploading through the API when object storage refuses the page's origin.

The regression: the app served on :8090 while MinIO's CORS allowed only
:5174, so the browser blocked every presigned PUT and every upload ended in
"The upload could not reach storage". The client now falls back to
`POST /api/files/<id>/content`; this asserts that path stores the bytes,
confirms the file, and stays bounded.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from tests.conftest import persona_claims

FILES = f"{Config.API_PREFIX}/api/files"


def _as(monkeypatch):
    monkeypatch.setattr("src.core.auth.tokens.verify_token", lambda _t: persona_claims("admin", "administrator", sid="up"))
    return {"Authorization": "Bearer up"}


def _begin(client, headers, body: bytes, name: str = "") -> str:
    name = name or f"fallback-{uuid4().hex[:6]}.pdf"
    begun = client.post(FILES, json={"name": name, "size_bytes": len(body), "mime_type": "application/pdf"},
                        headers=headers)
    assert begun.status_code == 201, begun.get_json()
    return begun.get_json()["file"]["id"]


@pytest.mark.database
def test_bytes_sent_through_the_api_are_stored_and_confirmed(client, monkeypatch):
    headers = _as(monkeypatch)
    body = b"%PDF-1.4 sent through the api"
    file_id = _begin(client, headers, body)
    sent = client.post(f"{FILES}/{file_id}/content", data=body, headers={**headers, "Content-Type": "application/octet-stream"})
    assert sent.status_code == 200, sent.get_json()
    assert sent.get_json()["status"] == "READY" and sent.get_json()["size_bytes"] == len(body)

    from src.core import storage
    from src.core.db import session_scope
    from src.models.content import FileObject

    with session_scope() as session:
        key = session.get(FileObject, file_id).storage_key
    assert storage.for_config().get(key) == body
    # Confirming afterwards, as the client still does, is harmless.
    assert client.post(f"{FILES}/{file_id}/confirm", headers=headers).status_code == 200
    # A second send is refused: the file is no longer waiting for bytes.
    assert client.post(f"{FILES}/{file_id}/content", data=body, headers=headers).status_code == 409


@pytest.mark.database
def test_the_fallback_is_bounded(client, monkeypatch):
    headers = _as(monkeypatch)
    monkeypatch.setattr(Config, "MAX_UPLOAD_MB", 0)
    file_id = _begin(client, headers, b"xx")
    refused = client.post(f"{FILES}/{file_id}/content", data=b"xx", headers=headers)
    assert refused.status_code == 400
