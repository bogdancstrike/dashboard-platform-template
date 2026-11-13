"""Team chat (§47): channels, direct messages, unread, search, reactions, presence. — joining leaving."""

from __future__ import annotations

from uuid import uuid4

import pytest

from tests.chat_support import (  # noqa: F401
    CHANNELS,
    PREFIX,
    _name,
    _post,
    _user_id,
    live_calls,
    people,
)


@pytest.mark.database
def test_joining_and_leaving_a_public_channel(client, people, live_calls):
    channel = client.post(CHANNELS, json={"name": _name()}, headers=people["admin"]).get_json()
    url = f"{CHANNELS}/{channel['id']}"
    joined = client.post(f"{url}/join", headers=people["analyst"]).get_json()
    assert joined["is_member"] is True
    left = client.post(f"{url}/leave", headers=people["analyst"]).get_json()
    assert left["left"] is True
    assert client.get(url, headers=people["analyst"]).get_json()["is_member"] is False
    # A non-member may not add people to a channel.
    assert client.post(f"{url}/members", json={"member_ids": []}, headers=people["analyst"]).status_code == 403
    assert client.delete(url, headers=people["analyst"]).status_code == 403


@pytest.mark.database
def test_search_finds_lines_only_in_rooms_the_reader_may_read(client, people, live_calls):
    marker = uuid4().hex[:10]
    public = client.post(CHANNELS, json={"name": _name()}, headers=people["admin"]).get_json()
    private = client.post(CHANNELS, json={"name": _name(), "visibility": "PRIVATE"},
                          headers=people["admin"]).get_json()
    _post(client, people["admin"], public["id"], f"public {marker}")
    _post(client, people["admin"], private["id"], f"private {marker}")

    mine = client.get(f"{PREFIX}/api/chat/search?q={marker}", headers=people["admin"]).get_json()
    assert mine["total"] == 2
    theirs = client.get(f"{PREFIX}/api/chat/search?q={marker}", headers=people["user"]).get_json()
    assert [item["body"] for item in theirs["items"]] == [f"public {marker}"]
    assert theirs["items"][0]["channel_name"] == public["name"]

    scoped = client.get(f"{PREFIX}/api/chat/search?q={marker}&channel_id={private['id']}",
                        headers=people["admin"]).get_json()
    assert scoped["total"] == 1
    assert client.get(f"{PREFIX}/api/chat/search?q=a", headers=people["admin"]).get_json()["items"] == []


@pytest.mark.database
def test_files_go_with_a_message(client, people, live_calls):
    from src.core.db import session_scope
    from src.models.content import FileObject

    with session_scope() as session:
        stored = FileObject(name="plan.pdf", mime_type="application/pdf", size_bytes=2048,
                            owner_id=_user_id("admin"), status="READY")
        session.add(stored)
        session.flush()
        file_id = str(stored.id)
    channel = client.post(CHANNELS, json={"name": _name()}, headers=people["admin"]).get_json()
    posted = _post(client, people["admin"], channel["id"], "", attachment_ids=[file_id])
    assert posted.status_code == 201, posted.get_json()
    assert posted.get_json()["attachments"] == [
        {"id": file_id, "name": "plan.pdf", "size_bytes": 2048, "mime_type": "application/pdf"}]
    listing = client.get(CHANNELS, headers=people["admin"]).get_json()
    row = next(item for item in listing["items"] if item["id"] == channel["id"])
    assert row["last_message"]["body"] == "📎 plan.pdf"

    assert _post(client, people["admin"], channel["id"], "x", attachment_ids=[str(uuid4())]).status_code == 404
    assert _post(client, people["admin"], channel["id"], "x", attachment_ids="nope").status_code == 400
    assert _post(client, people["admin"], channel["id"], "x", attachment_ids=[file_id] * 9).status_code == 400


@pytest.mark.database
def test_presence_is_reported_and_set(client, people, live_calls):
    from src.services.collaboration import presence

    presence.reset_for_tests()
    me = str(_user_id("admin"))
    assert client.post(f"{PREFIX}/api/chat/presence", json={"status": "away"},
                       headers=people["admin"]).get_json() == {"user_id": me, "status": "away"}
    statuses = client.get(f"{PREFIX}/api/chat/presence?ids={me}", headers=people["admin"]).get_json()
    assert statuses["statuses"] == {me: "away"}
    everyone = client.get(f"{PREFIX}/api/chat/presence", headers=people["admin"]).get_json()
    assert everyone["statuses"].get(me) == "away"
    assert client.post(f"{PREFIX}/api/chat/presence", json={"status": "invisible"},
                       headers=people["admin"]).status_code == 400
    presence.disconnected(me)
