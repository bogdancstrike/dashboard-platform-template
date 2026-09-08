"""The activity feed (§35, §48).

The claims worth asserting are the ones that make a feed usable rather than
decorative: that the kind strip counts the *whole* match rather than the page
that was downloaded, that choosing a chip does not change the other chips'
numbers, that a bad filter is a validation error rather than an empty feed
pretending nothing happened, and that this endpoint is not the audit ledger
wearing a lesser permission.
"""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
FEED = f"{PREFIX}/api/activity"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"activity-{username}"),
    )
    return {"Authorization": f"Bearer activity-{username}"}


def test_the_feed_needs_a_bearer_token(client):
    assert client.get(FEED).status_code == 401


def test_initials_are_one_rule_rather_than_two_that_disagree():
    """The same person must not get two avatars.

    This was written twice: the directory took the first and *last* words, the
    user endpoint took the first *two*. "Ada Marie Administrator" was `AA` on
    one screen and `AM` on another, and nothing said which was wrong.
    """
    from src.core.naming import initials

    assert initials("Ada Administrator") == "AA"
    # The case that separated the two copies.
    assert initials("Ada Marie Administrator") == "AA"
    assert initials("Prince") == "P"
    assert initials("") == "?"
    assert initials(None) == "?"


def test_the_kind_vocabulary_matches_what_writes_it():
    """The strip's kinds and `_activity_kind`'s outputs must be the same set.

    They are written in two places because one is a *vocabulary with labels
    and an order* and the other is a function over an action. Two lists that
    have to agree and nothing checking they do is how a page ends up unable to
    show a kind the platform is recording — silently, because an unlisted kind
    simply never appears.
    """
    from src.core.audit import _activity_kind
    from src.services.activity import KIND_LABELS

    actions = (
        "CREATE", "UPDATE", "DELETE", "COMMENT", "UPLOAD", "DOWNLOAD",
        "PERMISSION_CHANGE", "CONFIGURATION_CHANGE", "STATUS_CHANGE",
        "LOGIN", "LOGOUT", "LOGIN_FAILED", "IMPERSONATE", "SESSION_REVOKE",
        "ASSIGN", "EXPORT", "IMPORT", "BULK_UPDATE", "VIEW", "JOB_FAILED",
    )
    produced = {_activity_kind(action) for action in actions}
    assert produced <= set(KIND_LABELS), produced - set(KIND_LABELS)


@pytest.mark.database
def test_the_strip_counts_the_whole_match_not_the_page(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = client.get(f"{FEED}?period=all_time&page_size=5", headers=headers).get_json()

    assert len(body["items"]) <= 5
    counted = sum(entry["count"] for entry in body["kinds"])
    # The strip is the whole dataset's story, not the five rows on screen —
    # counting the page would give a number that silently means "of the five
    # I have" (§71).
    assert counted == body["matched"]
    assert counted > len(body["items"])
    assert body["total"] == counted


@pytest.mark.database
def test_choosing_a_kind_leaves_the_other_counts_alone(client, monkeypatch):
    """A strip whose numbers move when you use it cannot be used to compare."""
    headers = _authenticate(monkeypatch)
    everything = client.get(f"{FEED}?period=all_time", headers=headers).get_json()
    chosen = next(entry for entry in everything["kinds"] if entry["count"] > 0)

    narrowed = client.get(
        f"{FEED}?period=all_time&kind={chosen['key']}", headers=headers
    ).get_json()

    assert {entry["key"]: entry["count"] for entry in narrowed["kinds"]} == {
        entry["key"]: entry["count"] for entry in everything["kinds"]
    }
    # …while the rows themselves are only that kind, and the total follows.
    assert {item["kind"] for item in narrowed["items"]} == {chosen["key"]}
    assert narrowed["total"] == chosen["count"]


@pytest.mark.database
def test_every_kind_is_offered_even_at_zero(client, monkeypatch):
    """A kind that vanishes when nothing has happened teaches a reader that the
    platform has stopped recording it."""
    from src.services.activity import KINDS

    headers = _authenticate(monkeypatch)
    body = client.get(f"{FEED}?period=all_time", headers=headers).get_json()

    assert [entry["key"] for entry in body["kinds"]] == [key for key, _ in KINDS]
    assert all("label" in entry for entry in body["kinds"])


@pytest.mark.database
def test_an_entry_carries_where_its_subject_lives(client, monkeypatch):
    """The path comes from the resource declaration, not from a URL the browser
    assembles — a feed that built its own links would be a second router."""
    headers = _authenticate(monkeypatch)
    body = client.get(
        f"{FEED}?period=all_time&resource_type=project", headers=headers
    ).get_json()

    assert body["items"], "the seed records nothing against projects"
    for item in body["items"]:
        assert item["resource_type"] == "project"
        assert item["resource_path"] == f"/projects/{item['resource_id']}"
        assert item["summary"]
        assert item["kind_label"]
        # Initials from the server's one rule, not a split in the browser.
        if item["actor"]["name"]:
            assert item["actor"]["initials"]


@pytest.mark.database
def test_an_unknown_filter_is_refused_rather_than_answered_emptily(client, monkeypatch):
    """An empty feed reads as "nothing happened", which is a different and
    wrong answer (§34)."""
    headers = _authenticate(monkeypatch)

    bad_kind = client.get(f"{FEED}?kind=WHATEVER", headers=headers)
    assert bad_kind.status_code == 400
    assert "activity kind" in bad_kind.get_json()["message"]

    bad_dataset = client.get(f"{FEED}?resource_type=unicorn", headers=headers)
    assert bad_dataset.status_code == 400
    assert "unicorn" in bad_dataset.get_data(as_text=True)


@pytest.mark.database
def test_the_feed_is_not_the_audit_ledger_behind_a_lesser_permission(client, monkeypatch):
    """A viewer reads the feed and is refused the ledger (§13).

    This is the whole reason the two are separate endpoints. The feed answers
    "what has been going on" and needs `records.view`; the ledger is evidence
    — who, from which address, with which values before and after — and needs
    `audit.view`, which a viewer does not have. (The per-record *timeline*
    deliberately sits at `records.view` too: reading the history of a record
    you may already read is not reading everything anybody has ever done.)
    """
    headers = _authenticate(monkeypatch, "user", "viewer")

    assert client.get(f"{FEED}?period=all_time", headers=headers).status_code == 200
    assert client.get(f"{PREFIX}/admin/audit", headers=headers).status_code == 403

    # And the feed never carries what the ledger carries, whoever reads it.
    body = client.get(f"{FEED}?period=all_time", headers=headers).get_json()
    for item in body["items"]:
        assert "ip_address" not in item
        assert "state_before" not in item
        assert "user_agent" not in item


@pytest.mark.database
def test_the_default_window_is_recent_rather_than_everything(client, monkeypatch):
    """A feed with no window reads the whole table to answer "what happened",
    which gets slower every day the platform is used."""
    headers = _authenticate(monkeypatch)
    default = client.get(FEED, headers=headers).get_json()
    forever = client.get(f"{FEED}?period=all_time", headers=headers).get_json()

    assert default["period"] == "last_30_days"
    assert default["matched"] <= forever["matched"]
