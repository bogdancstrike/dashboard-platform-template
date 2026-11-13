"""Shared helpers and fixtures for the feature flags tests."""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.api import endpoint_map
from src.config import Config
from src.core import features
from src.core.feature_catalogue import (
    FEATURES,
)
from src.core.features import FlagState
from tests.patching import patch_package

PREFIX = Config.API_PREFIX


REPO = Path(__file__).resolve().parents[2]


def _state(key: str, enabled: bool = True, **kwargs) -> FlagState:
    values = {
        "rollout_percentage": 100, "target_user_ids": (), "target_roles": (),
        "target_group_ids": (), "target_organization_ids": (),
    }
    values.update(kwargs)
    return FlagState(key=key, enabled=enabled, **values)


def _all_on(**overrides: FlagState) -> dict[str, FlagState]:
    states = {feature.key: _state(feature.key) for feature in FEATURES}
    states.update(overrides)
    return states


@pytest.fixture()
def flags(monkeypatch):
    """Control the flag snapshot without touching the shared database."""
    current: dict[str, dict[str, FlagState]] = {"states": _all_on()}
    patch_package(monkeypatch, features, "snapshot", lambda: current["states"])

    def set_off(*keys: str) -> None:
        current["states"] = _all_on(**{key: _state(key, enabled=False) for key in keys})

    def set_states(states: dict[str, FlagState]) -> None:
        current["states"] = states

    return SimpleNamespace(off=set_off, set=set_states, current=current)


ENTRIES = endpoint_map.load()["endpoints"]


FLAGGED = [entry for entry in ENTRIES if features.owner_of(entry["api_url"])[0]]


def _url(api_url: str) -> str:
    def fill(match: re.Match) -> str:
        return str(uuid.uuid4()) if match.group(1) == "uuid" else "x"

    return PREFIX + re.sub(r"<(\w+):\w+>", fill, api_url)


def _signed_in(monkeypatch):
    patch_package(monkeypatch, features, "_caller", lambda: SimpleNamespace(
        user_id=uuid.uuid4(), role_code="ADMINISTRATOR", groups=(), organization_id=None,
    ))


class _Socket:
    def __init__(self):
        self.sent: list[str] = []
        self.closed = False

    def send(self, message):
        self.sent.append(message)

    def close(self):
        self.closed = True


def _frontend_features() -> str:
    return (REPO / "frontend/src/settings/features.ts").read_text(encoding="utf-8")


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    from tests.conftest import persona_claims

    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"ff-{username}"),
    )
    return {"Authorization": f"Bearer ff-{username}"}


@pytest.fixture()
def temp_flag():
    """A flag of the test's own, removed afterwards — never a shared one."""
    from sqlalchemy import delete

    from src.core.db import session_scope
    from src.models.platform import FeatureFlag

    key = f"test-ff-{uuid.uuid4().hex[:8]}"
    yield key
    with session_scope() as session:
        session.execute(delete(FeatureFlag).where(FeatureFlag.key == key))
    features.invalidate()
