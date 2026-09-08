"""Announcements — the platform talking to the people using it (§17, §34).

The claims worth asserting are the ones that decide whether anybody trusts a
notice: that "live" is computed rather than swept by a job, that the audience
is honoured in SQL rather than filtered after the fact, that reading and
acknowledging stay separate facts, and that writing one is a privilege while
reading one is not.
"""

from __future__ import annotations

from datetime import timedelta

import pytest

from src.config import Config
from src.core.clock import iso, now
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
FEED = f"{PREFIX}/api/announcements"
DRAFTS = f"{PREFIX}/api/announcements/drafts"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"notice-{username}"),
    )
    return {"Authorization": f"Bearer notice-{username}"}


def _notice(client, headers, **overrides):
    """Publish one and return it, so each test states its own conditions."""
    moment = now()
    payload = {
        "title": "A notice",
        "body": "Something worth knowing.",
        "category": "NEWS",
        "severity": "INFO",
        "status": "PUBLISHED",
        "publish_at": iso(moment - timedelta(hours=1)),
    }
    payload.update(overrides)
    response = client.post(FEED, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def test_the_feed_needs_a_bearer_token(client):
    assert client.get(FEED).status_code == 401
    assert client.post(FEED, json={"title": "x"}).status_code == 401


@pytest.mark.database
def test_writing_one_is_a_privilege_and_reading_one_is_not(client, monkeypatch):
    """A notice is addressed to everybody by definition, so reading it is not a
    privilege. Publishing one is a broadcast, and that is.

    Marked `database` although the refusal happens before any *query* of this
    module's: building a principal reads the user's row, so every
    authenticated endpoint needs one.
    """
    viewer = _authenticate(monkeypatch, "user", "viewer")
    refused = client.post(FEED, json={"title": "Not yours"}, headers=viewer)
    assert refused.status_code == 403
    assert "announcements.manage" in refused.get_data(as_text=True)


@pytest.mark.database
def test_a_viewer_reads_the_notices_addressed_to_them(client, monkeypatch):
    viewer = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(FEED, headers=viewer).status_code == 200


@pytest.mark.database
def test_live_is_computed_rather_than_swept(client, monkeypatch):
    """A status swept to EXPIRED by a job is wrong between sweeps — and the
    sweep is exactly the thing nobody notices has stopped."""
    headers = _authenticate(monkeypatch)
    moment = now()

    live = _notice(client, headers, title="Live now")
    past = _notice(
        client, headers, title="Ran out",
        publish_at=iso(moment - timedelta(days=30)),
        expires_at=iso(moment - timedelta(days=1)),
    )
    ahead = _notice(
        client, headers, title="Not yet", status="SCHEDULED",
        publish_at=iso(moment + timedelta(days=3)),
    )

    # All three are stored with a status that is *not* "expired": the
    # difference is derived from the window on every read.
    assert live["is_live"] and not live["is_expired"]
    assert past["status"] == "PUBLISHED" and past["is_expired"] and not past["is_live"]
    assert ahead["is_scheduled"] and not ahead["is_live"]

    # Matched by id, not by title: the noticeboard is a shared, paginated
    # list, and a test that reads page one is a test that passes only while
    # the database is small.
    def listed(**params) -> set[str]:
        query = "&".join(f"{key}={value}" for key, value in params.items())
        body = client.get(f"{FEED}?page_size=200&{query}", headers=headers).get_json()
        return {item["id"] for item in body["items"]}

    current = listed()
    assert live["id"] in current
    assert past["id"] not in current
    assert ahead["id"] not in current

    # And history is retrievable without being shown every morning.
    history = listed(include_expired="true")
    assert past["id"] in history
    # Never a draft, though: that is its author's business.
    body = client.get(f"{FEED}?page_size=200&include_expired=true", headers=headers).get_json()
    assert all(item["status"] != "DRAFT" for item in body["items"])


@pytest.mark.database
def test_the_audience_is_what_a_reader_is(client, monkeypatch):
    """Addressed by role, so it reaches whoever holds it — including people who
    had not joined when it was written."""
    author = _authenticate(monkeypatch)
    _notice(client, author, title="Managers only", audience_roles=["MANAGER"])
    _notice(client, author, title="Everybody")

    manager = _authenticate(monkeypatch, "manager", "manager")
    seen = [item["title"] for item in client.get(FEED, headers=manager).get_json()["items"]]
    assert "Managers only" in seen
    assert "Everybody" in seen

    viewer = _authenticate(monkeypatch, "user", "viewer")
    theirs = [item["title"] for item in client.get(FEED, headers=viewer).get_json()["items"]]
    assert "Managers only" not in theirs
    assert "Everybody" in theirs


@pytest.mark.database
def test_a_notice_for_another_role_is_not_found_rather_than_forbidden(client, monkeypatch):
    """Telling somebody a notice exists but is not for them is itself a
    disclosure about who is being told what."""
    author = _authenticate(monkeypatch)
    hidden = _notice(client, author, title="Managers only", audience_roles=["MANAGER"])

    viewer = _authenticate(monkeypatch, "user", "viewer")
    response = client.get(f"{FEED}/{hidden['id']}", headers=viewer)
    assert response.status_code == 404


@pytest.mark.database
def test_the_list_and_the_single_row_agree_about_who_may_see_what(client, monkeypatch):
    """The audience rule exists twice — as SQL for the list and in Python for
    one row — so this asserts they say the same thing."""
    author = _authenticate(monkeypatch)
    _notice(client, author, title="Managers only", audience_roles=["MANAGER"])
    open_notice = _notice(client, author, title="Everybody")

    viewer = _authenticate(monkeypatch, "user", "viewer")
    listed = {item["id"] for item in client.get(FEED, headers=viewer).get_json()["items"]}
    assert open_notice["id"] in listed
    assert client.get(f"{FEED}/{open_notice['id']}", headers=viewer).status_code == 200


@pytest.mark.database
def test_reading_and_acknowledging_are_separate_facts(client, monkeypatch):
    """"Everybody has seen it" and "eleven people agreed to it" are different
    questions, and a notice that asks for a response needs the second."""
    author = _authenticate(monkeypatch)
    notice = _notice(
        client, author, title="Sign-on policy", severity="CRITICAL",
        requires_acknowledgement=True,
    )

    read = client.post(f"{FEED}/{notice['id']}/receipt", json={}, headers=author).get_json()
    assert read["read_at"] is not None
    assert read["acknowledged_at"] is None

    agreed = client.post(
        f"{FEED}/{notice['id']}/receipt", json={"acknowledged": True}, headers=author
    ).get_json()
    assert agreed["acknowledged_at"] is not None
    # Idempotent: a page that marks on render sends this more than once, and
    # the second must not move the first one's timestamp.
    assert agreed["read_at"] == read["read_at"]
    again = client.post(
        f"{FEED}/{notice['id']}/receipt", json={"acknowledged": True}, headers=author
    ).get_json()
    assert again["acknowledged_at"] == agreed["acknowledged_at"]


@pytest.mark.database
def test_acknowledging_a_notice_that_does_not_ask_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    notice = _notice(client, headers, title="Just news")

    response = client.post(
        f"{FEED}/{notice['id']}/receipt", json={"acknowledged": True}, headers=headers
    )
    assert response.status_code == 400
    assert "acknowledged" in response.get_data(as_text=True)


@pytest.mark.database
def test_the_unread_count_and_the_filter_agree(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    notice = _notice(client, headers, title="Fresh")

    before = client.get(FEED, headers=headers).get_json()
    unread_ids = {
        item["id"]
        for item in client.get(f"{FEED}?unread=true", headers=headers).get_json()["items"]
    }
    assert notice["id"] in unread_ids
    assert before["unread"] == len(unread_ids) or before["unread"] >= len(unread_ids)

    client.post(f"{FEED}/{notice['id']}/receipt", json={}, headers=headers)
    after = client.get(FEED, headers=headers).get_json()
    assert after["unread"] == before["unread"] - 1
    assert notice["id"] not in {
        item["id"]
        for item in client.get(f"{FEED}?unread=true", headers=headers).get_json()["items"]
    }


@pytest.mark.database
def test_every_category_is_offered_with_a_count_over_the_whole_match(client, monkeypatch):
    from src.services.announcements import CATEGORIES

    headers = _authenticate(monkeypatch)
    _notice(client, headers, title="A release", category="RELEASE")
    body = client.get(f"{FEED}?page_size=1", headers=headers).get_json()

    assert [entry["key"] for entry in body["categories"]] == [key for key, _ in CATEGORIES]
    # The counts are the period's, not the one row returned (§71).
    assert sum(entry["count"] for entry in body["categories"]) > len(body["items"])
    # And a category with nothing in it is still offered, at zero.
    assert any(entry["count"] == 0 for entry in body["categories"])


@pytest.mark.database
def test_a_window_that_closes_before_it_opens_is_refused(client, monkeypatch):
    """It would fail silently otherwise: the list simply never matches it."""
    headers = _authenticate(monkeypatch)
    moment = now()
    response = client.post(
        FEED,
        json={
            "title": "Impossible",
            "publish_at": iso(moment + timedelta(days=2)),
            "expires_at": iso(moment + timedelta(days=1)),
        },
        headers=headers,
    )
    assert response.status_code == 400
    assert "expire before it is published" in response.get_json()["message"]


@pytest.mark.database
def test_an_audience_that_is_not_a_role_is_refused(client, monkeypatch):
    """`MANAGERS` is not a role code — `MANAGER` is — and a notice addressed to
    it reaches nobody, silently."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        FEED, json={"title": "Typo", "audience_roles": ["MANAGERS"]}, headers=headers
    )
    assert response.status_code == 400
    assert "MANAGERS" in response.get_data(as_text=True)


@pytest.mark.database
def test_the_authors_list_shows_every_state_and_needs_the_permission(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    _notice(client, headers, title="A draft", status="DRAFT", publish_at=None)

    body = client.get(DRAFTS, headers=headers).get_json()
    assert "A draft" in [item["title"] for item in body["items"]]
    # And how far each one reached, which is the author's question.
    assert all("reach" in item for item in body["items"])

    viewer = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(DRAFTS, headers=viewer).status_code == 403


@pytest.mark.database
def test_withdrawing_one_is_soft_and_audited(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    notice = _notice(client, headers, title="Withdrawn")

    assert client.delete(f"{FEED}/{notice['id']}", headers=headers).status_code == 200
    assert client.get(f"{FEED}/{notice['id']}", headers=headers).status_code == 404

    # A notice people remember receiving has to stay pointable-at (§21).
    trail = client.get(
        f"{PREFIX}/admin/audit?resource_type=announcement", headers=headers
    ).get_json()
    assert any(item["action"] == "DELETE" for item in trail["items"])
