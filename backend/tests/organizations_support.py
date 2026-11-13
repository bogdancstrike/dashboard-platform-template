"""Shared helpers and fixtures for the organizations tests."""

from __future__ import annotations

import uuid

import pytest

from src.config import Config
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


ORGS = f"{PREFIX}/admin/organizations"


DEPARTMENTS = f"{PREFIX}/admin/departments"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"org-{username}"),
    )
    return {"Authorization": f"Bearer org-{username}"}


def _any_organization(client, headers) -> dict:
    listing = client.get(f"{ORGS}?page_size=5", headers=headers).get_json()
    assert listing["items"], "the seed has no organizations"
    return listing["items"][0]


def _make_department(client, headers, organization_id: str, **extra) -> dict:
    body = {
        "name": extra.pop("name", f"Test dept {uuid.uuid4().hex[:6]}"),
        "code": extra.pop("code", f"T{uuid.uuid4().hex[:6].upper()}"),
        **extra,
    }
    answer = client.post(
        f"{ORGS}/{organization_id}/departments", headers=headers, json=body
    )
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()
