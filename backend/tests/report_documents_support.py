"""Shared helpers and fixtures for the report documents tests."""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


DOCUMENTS = f"{PREFIX}/api/report-documents"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda token: persona_claims(
            _persona_of(token), _role_of(token), sid=f"documents-{_persona_of(token)}"
        ),
    )
    return {"Authorization": f"Bearer documents-{username}-{role}"}


def _persona_of(token: str) -> str:
    return str(token).split("-")[1] if "-" in str(token) else "admin"


def _role_of(token: str) -> str:
    parts = str(token).split("-")
    return parts[2] if len(parts) > 2 else "administrator"


@pytest.fixture()
def document(client, monkeypatch):
    """One document owned by the administrator, removed on the way out."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        DOCUMENTS,
        json={
            "name": "Quarterly review",
            "page": {"size": "A4", "footer": "Confidential", "subtitle": "Q3"},
        },
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()
    saved = response.get_json()
    try:
        yield saved
    finally:
        _erase(saved["id"])


def _erase(document_id: str) -> None:
    from src.core.db import session_scope
    from src.models.personal import ReportDocument, ResourceShare

    with session_scope() as session:
        session.query(ResourceShare).filter(
            ResourceShare.resource_type == "report_document",
            ResourceShare.resource_id == str(document_id),
        ).delete(synchronize_session=False)
        session.query(ReportDocument).filter(
            ReportDocument.id == document_id
        ).delete(synchronize_session=False)


#: A one-pixel PNG, as the browser posts one: a real capture, so the only
#: reason it can be left out of a file is the one under test.
_PIXEL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
