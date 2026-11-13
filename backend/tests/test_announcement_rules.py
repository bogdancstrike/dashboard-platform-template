"""The noticeboard's write rules and who a notice reaches.

`test_announcements` covers the feed and receipts. These pin each validation
the editor relies on, partial edits, removal, and the single-row visibility
rule (`_visible_to`) for every way a notice can be out of reach: a draft, not
yet published, expired, another role's, another organization's.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest

from src.core.clock import iso, now
from src.services.collaboration import announcements as service
from tests.personas import PREFIX, as_each, principal

FEED = f"{PREFIX}/api/announcements"
DRAFTS = f"{PREFIX}/api/announcements/drafts"

pytestmark = pytest.mark.database


@pytest.mark.parametrize(("body", "says"), [
    ({"title": "x", "colour": "red"}, "Unknown fields"),
    ({"title": "  "}, "needs a title"),
    ({"title": "x", "category": "GOSSIP"}, "category"),
    ({"title": "x", "severity": "APOCALYPTIC"}, "severity"),
    ({"title": "x", "status": "SHOUTED"}, "status"),
    ({"title": "x", "publish_at": "tomorrow-ish"}, "ISO 8601"),
    ({"title": "x", "audience_roles": "MANAGER"}, "array of role codes"),
    ({"title": "x", "audience_roles": ["MANAGERS"]}, "not role codes"),
    ({"title": "x", "organization_id": "nope"}, "organization_id"),
    ({"title": "x", "organization_id": str(uuid4())}, "your own organization"),
    ({"title": "x", "publish_at": "2027-01-02T00:00:00Z", "expires_at": "2027-01-01T00:00:00"}, "expire before"),
])
def test_a_bad_notice_is_refused_with_its_reason(client, monkeypatch, body, says):
    admin = as_each(monkeypatch)("admin")
    response = client.post(FEED, json=body, headers=admin)
    assert response.status_code == 400, response.get_json()
    assert says.lower() in response.get_json()["message"].lower()


def test_a_notice_is_edited_in_part_listed_as_a_draft_and_removed(client, monkeypatch):
    headers = as_each(monkeypatch)
    admin = headers("admin")
    created = client.post(FEED, json={"title": "Rules probe", "body": " text ", "category": "news",
                                      "audience_roles": ["manager", "MANAGER"], "link": "  ",
                                      "organization_id": ""}, headers=admin)
    assert created.status_code == 201, created.get_json()
    notice = created.get_json()
    assert notice["status"] == "DRAFT" and notice["audience_roles"] == ["MANAGER"] and notice["link"] is None

    drafts = client.get(f"{DRAFTS}?status=draft", headers=admin).get_json()
    assert notice["id"] in {item["id"] for item in drafts["items"]}
    assert client.get(f"{DRAFTS}?status=LOUD", headers=admin).status_code == 400

    edited = client.put(f"{FEED}/{notice['id']}", json={"severity": "warning", "is_pinned": True}, headers=admin)
    assert edited.status_code == 200 and edited.get_json()["severity"] == "WARNING"
    assert edited.get_json()["title"] == "Rules probe"  # untouched by a partial edit
    assert client.put(f"{FEED}/{notice['id']}", json=["not", "an", "object"], headers=admin).status_code == 400

    # Only a manager of notices edits or removes them.
    viewer = headers("user")
    assert client.put(f"{FEED}/{notice['id']}", json={"title": "x"}, headers=viewer).status_code == 403
    assert client.delete(f"{FEED}/{notice['id']}", headers=viewer).status_code == 403

    assert client.delete(f"{FEED}/{notice['id']}", headers=admin).get_json()["deleted"] is True
    assert client.get(f"{FEED}/{notice['id']}", headers=admin).status_code == 404
    assert client.put(f"{FEED}/{notice['id']}", json={"title": "x"}, headers=admin).status_code == 404


def test_a_draft_cannot_be_marked_read_by_anybody(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    draft = client.post(FEED, json={"title": "Unpublished"}, headers=admin).get_json()
    assert client.post(f"{FEED}/{draft['id']}/receipt", json={"read": True}, headers=admin).status_code == 404


def test_the_feed_filters_by_category_and_includes_the_archive_on_request(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    assert client.get(f"{FEED}?category=GOSSIP", headers=admin).status_code == 400
    everything = client.get(f"{FEED}?include=all&category=news", headers=admin)
    assert everything.status_code == 200
    assert all(item["category"] == "NEWS" for item in everything.get_json()["items"])


def test_a_notice_reaches_only_its_audience_and_only_while_live(app):
    reader = principal(app, "manager")
    moment = now()

    def notice(**over):
        base = dict(deleted_at=None, status="PUBLISHED", publish_at=None, expires_at=None,
                    audience_roles=[], organization_id=reader.organization_id)
        return SimpleNamespace(**{**base, **over})

    assert service._visible_to(notice(), reader, moment)
    assert service._visible_to(notice(audience_roles=[reader.role_code]), reader, moment)
    assert service._visible_to(notice(organization_id=None), reader, moment)
    for out_of_reach in (notice(deleted_at=moment), notice(status="DRAFT"),
                         notice(publish_at=moment + timedelta(hours=1)),
                         notice(expires_at=moment - timedelta(seconds=1)),
                         notice(audience_roles=["ADMINISTRATOR"]),
                         notice(organization_id=uuid4())):
        assert not service._visible_to(out_of_reach, reader, moment)
    # A reader with no organization sees notices addressed to all.
    stateless = replace(reader, organization_id=None)
    assert service._visible_to(notice(organization_id=None), stateless, moment)


def test_an_instant_without_a_zone_is_utc():
    assert iso(service._moment("2027-01-02T03:04:05", "publish_at")) == "2027-01-02T03:04:05Z"
    assert service._moment("", "publish_at") is None
    assert service._category("") == "" and service._status(None) == ""
