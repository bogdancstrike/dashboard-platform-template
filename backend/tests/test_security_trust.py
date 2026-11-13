"""The reader's own security page (§41): sessions, sign-ins, and enforcement. — trust."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from src.services.people import security as service
from tests.security_support import (  # noqa: F401
    SECURITY,
    _authenticate,
    _failed_sign_in,
    _row,
    _security_event,
    _tokens,
    pytestmark,
)


def test_a_device_can_be_marked_recognised_and_unmarked(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch)
    mine = _row(client, headers)

    marked = client.put(
        f"{SECURITY}/sessions/{mine['id']}", json={"trusted": True}, headers=headers
    )
    assert marked.status_code == 200
    assert marked.get_json()["trusted"] is True

    unmarked = client.put(
        f"{SECURITY}/sessions/{mine['id']}", json={"trusted": False}, headers=headers
    )
    assert unmarked.get_json()["trusted"] is False


def test_the_history_shows_failures_as_well_as_successes(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "admin", "administrator")
    body = client.get(f"{SECURITY}/sign-ins?page_size=100", headers=headers).get_json()

    assert body["window_days"] == service.HISTORY_DAYS
    results = {item["result"] for item in body["items"]}
    # A failed sign-in is what somebody opens this page to look for, so it
    # must not be filtered out of the list it belongs in.
    assert results, "the seed left this persona no sign-in history"
    assert results <= {"SUCCESS", "FAILURE"}


def test_the_history_can_be_narrowed_to_the_failures_in_sql(client, monkeypatch):
    made = _failed_sign_in("analyst")
    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    whole = client.get(f"{SECURITY}/sign-ins?page_size=200", headers=headers).get_json()
    failures = client.get(
        f"{SECURITY}/sign-ins?result=FAILURE&page_size=200", headers=headers
    ).get_json()

    assert failures["total"] >= 1
    assert failures["total"] <= whole["total"]
    # Narrowed by PostgreSQL, not by the page: the total moves with the filter
    # rather than only the rows on screen (§71).
    assert {item["result"] for item in failures["items"]} == {"FAILURE"}
    assert made in {item["id"] for item in failures["items"]}
    # And the reason, which is the difference between "somebody tried your
    # password" and "your session expired".
    mine = next(item for item in failures["items"] if item["id"] == made)
    assert mine["reason"] == "Wrong password"
    assert mine["ip_address"] == "203.0.113.9"


def test_the_history_is_mine_and_only_mine(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    mine = client.get(f"{SECURITY}/sign-ins?page_size=200", headers=headers).get_json()

    from src.models.identity import LoginEvent, User

    with session_scope() as session:
        me = session.scalar(select(User).where(User.username == "analyst"))
        theirs = {
            str(row.id)
            for row in session.scalars(
                select(LoginEvent).where(LoginEvent.user_id != me.id).limit(50)
            )
        }
    assert theirs, "the seed has no other people's sign-ins to leak"
    assert not ({item["id"] for item in mine["items"]} & theirs)


def test_an_event_can_be_resolved_and_reopened(client, monkeypatch):
    made = _security_event("analyst")
    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    listing = client.get(f"{SECURITY}/events?page_size=100", headers=headers).get_json()
    first = next(item for item in listing["items"] if item["id"] == made)
    assert first["resolved"] is False

    resolved = client.put(
        f"{SECURITY}/events/{first['id']}", json={"resolved": True}, headers=headers
    )
    assert resolved.status_code == 200
    assert resolved.get_json()["resolved"] is True

    # Reversible, and not a delete: "I have seen this and it was me" is worth
    # recording, and losing the row would leave the page unable to say whether
    # anything was ever looked at.
    reopened = client.put(
        f"{SECURITY}/events/{first['id']}", json={"resolved": False}, headers=headers
    )
    assert reopened.get_json()["resolved"] is False


def test_every_seeded_event_severity_is_one_the_page_can_colour():
    from src.core import vocabulary
    from src.models.identity import SecurityEvent

    with session_scope() as session:
        found = {
            row[0] for row in session.execute(select(SecurityEvent.severity).distinct()).all()
        }
    assert found, "run `make seed`; there are no security events"
    # Declared in `core/vocabulary` rather than spelled in the seed: a
    # severity only the seed knows about is one the page renders with no
    # colour and no label.
    assert found <= set(vocabulary.SECURITY_SEVERITY)


def test_somebody_elses_event_cannot_be_resolved(client, monkeypatch):
    from src.models.identity import SecurityEvent, User

    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    with session_scope() as session:
        me = session.scalar(select(User).where(User.username == "analyst"))
        theirs = session.scalar(
            select(SecurityEvent).where(SecurityEvent.user_id != me.id).limit(1)
        )
    assert theirs is not None, "the seed has no other people's events"

    # 404 rather than 403: the reply must not confirm the event exists.
    answer = client.put(
        f"{SECURITY}/events/{theirs.id}", json={"resolved": True}, headers=headers
    )
    assert answer.status_code == 404


def test_the_overview_answers_is_anything_wrong(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "admin", "administrator")
    body = client.get(f"{SECURITY}/overview", headers=headers).get_json()

    assert body["window_days"] == service.HISTORY_DAYS
    assert body["active_sessions"] >= 1, "the request's own session is one"
    assert body["current_known"] is True
    # The one number that earns a sentence at the top of the page, derived
    # rather than left to the reader's arithmetic.
    assert body["failures_worth_saying"] is (
        body["failed_sign_ins"] >= service.FAILURES_WORTH_SAYING
    )


def test_the_overview_counts_only_this_account(client, monkeypatch):
    headers, _sid = _authenticate(monkeypatch, "analyst", "analyst")
    mine = client.get(f"{SECURITY}/overview", headers=headers).get_json()

    from src.models.identity import LoginEvent

    with session_scope() as session:
        everyone = session.scalar(
            select(__import__("sqlalchemy").func.count())
            .select_from(LoginEvent)
            .where(LoginEvent.result != "SUCCESS")
        )
    assert everyone > mine["failed_sign_ins"], "the count is not scoped to this account"
