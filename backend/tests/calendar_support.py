"""Shared helpers and fixtures for the calendar tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from src.config import Config
from src.services.work import calendar as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX


EVENTS = f"{PREFIX}/api/calendar/events"


UTC = timezone.utc


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"cal-{username}"),
    )
    return {"Authorization": f"Bearer cal-{username}"}


class _Event:
    """The smallest thing `_expand` reads, so the expander can be tested alone.

    A stand-in rather than a real row: the expander only ever touches five
    attributes, and building an ORM object (with an organisation, an organiser
    and a flush) to assert "the 31st skips February" would put a database
    between the claim and the code that makes it.
    """

    def __init__(self, starts, ends, recurrence=None, until=None):
        self.id = "11111111-1111-1111-1111-111111111111"
        self.title = "Series"
        self.starts_at = starts
        self.ends_at = ends
        self.recurrence = recurrence
        self.recurrence_until = until
        self.all_day = False
        self.status = "CONFIRMED"
        self.category = "MEETING"
        self.organizer_id = None
        self.participants = None


def _starts(occurrences) -> list[str]:
    return [item.starts_at.date().isoformat() for item in occurrences]


def _occurrence(title: str, start: datetime, minutes: int, *, user, all_day=False):
    event = _Event(start, start + timedelta(minutes=minutes))
    event.title = title
    event.all_day = all_day
    event.participants = [{"user_id": str(user), "response": "ACCEPTED"}]
    return service.Occurrence(event, start, start + timedelta(minutes=minutes))


pytestmark_db = pytest.mark.database
