"""Shared helpers and fixtures for the workflows tests."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


RULES = f"{PREFIX}/api/automations/rules"


CATALOG = f"{PREFIX}/api/automations/catalog"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"auto-{username}"),
    )
    return {"Authorization": f"Bearer auto-{username}"}


def _condition(field: str = "status", values: tuple[str, ...] = ("NEW",)) -> dict:
    """One rule in the shape react-awesome-query-builder exports."""
    return {
        "type": "group",
        "conjunction": "AND",
        "children1": {
            "a": {
                "type": "rule",
                "properties": {
                    "field": field,
                    "operator": "select_any_in",
                    "value": [list(values)],
                },
            }
        },
    }


def _rule(client, headers, **overrides):
    payload = {
        "name": "Test automation",
        "resource_type": "task",
        "condition_tree": _condition(),
        "actions": [
            {"kind": "NOTIFY", "recipients": {"owner": True}, "title": "{rule}: {record}"}
        ],
        "cooldown_minutes": 60,
    }
    payload.update(overrides)
    response = client.post(RULES, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _mine(rule_id: str):
    """Notifications *this rule* wrote.

    Scoped by `group_key` and never by category: a query for every `ALERT`
    notification passes on a clean database and fails the moment anything else
    has written one — which is what the Playwright suite does two minutes
    later, and the failure then lands on a test that changed nothing.
    """
    from src.models.platform import Notification

    return select(Notification).where(Notification.group_key == f"automation:{rule_id}")


def _run(client, headers, rule_id, *, dry_run=True):
    response = client.post(
        f"{RULES}/{rule_id}/run", json={"dry_run": dry_run}, headers=headers
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()
