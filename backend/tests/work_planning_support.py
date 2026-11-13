"""Shared helpers and fixtures for the work planning tests."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


pytestmark = pytest.mark.database


def _as(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"planning-{username}"),
    )
    return {"Authorization": f"Bearer planning-{username}"}


def _project(client, headers) -> str:
    response = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={"resource_type": "project", "columns": ["code"], "page": 1, "page_size": 1, "sort": "code"},
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()["items"][0]["id"]


def _task(client, headers, title: str, **extra) -> dict:
    made = client.post(
        f"{PREFIX}/api/records/task", headers=headers,
        json={"title": title, "status": extra.pop("status", "NEW"), **extra},
    )
    assert made.status_code == 201, made.get_data(as_text=True)
    body = made.get_json()
    return body | {"reference": body["subtitle"]}


def _day(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()
