"""Shared helpers and fixtures for the settings tests."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database


PREFIX = Config.API_PREFIX


SETTINGS = f"{PREFIX}/admin/settings"


FLAGS = f"{PREFIX}/admin/flags"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"cfg-{username}"),
    )
    return {"Authorization": f"Bearer cfg-{username}"}


def _find(answer, key: str) -> dict:
    for group in answer["groups"]:
        for item in group["items"]:
            if item["key"] == key:
                return item
    raise AssertionError(f"{key} is not in the settings")


def _restore(key: str) -> None:
    """Put a setting back at its default, whatever a test did to it."""
    from src.models.platform import SystemSetting

    with session_scope() as session:
        row = session.scalar(select(SystemSetting).where(SystemSetting.key == key))
        if row is not None:
            row.value = row.default_value


class _Flag:
    """The five attributes `is_on` reads, and nothing else."""

    def __init__(self, **overrides):
        self.key = "sample"
        self.enabled = True
        self.rollout_percentage = 0
        self.target_user_ids = None
        self.target_roles = None
        for name, value in overrides.items():
            setattr(self, name, value)
