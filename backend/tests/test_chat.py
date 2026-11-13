"""Team chat (§47): channels, direct messages, unread, search, reactions, presence.

A channel's messages are comments, so most of what is asserted here is the
*room's* rules travelling with them: a private room is invisible to a
non-member, posting in a public room joins it, unread counts are the lines
other people wrote after one's marker, and a mention reaches the person named.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
CHANNELS = f"{PREFIX}/api/chat/channels"
COMMENTS = f"{PREFIX}/api/comments"

ROLES = {"admin": "administrator", "manager": "manager", "operator": "operator",
         "analyst": "analyst", "user": "user"}


@pytest.fixture()
def people(monkeypatch):
    """Headers for each persona, one token per person."""

    def verify(token: str):
        username = token.removeprefix("chat-")
        return persona_claims(username, ROLES[username], sid=f"chat-{username}")

    monkeypatch.setattr("src.core.auth.verify_token", verify)
    return {name: {"Authorization": f"Bearer chat-{name}"} for name in ROLES}


@pytest.fixture()
def live_calls(monkeypatch):
    """Every live hint published, instead of sending it anywhere."""
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr("src.services.live.publish_to_user",
                        lambda user, payload: calls.append((str(user), payload)) or 1)
    monkeypatch.setattr("src.services.live.publish_to_all",
                        lambda payload: calls.append(("*", payload)) or 1)
    return calls


def _user_id(username: str) -> UUID:
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        return session.scalars(select(User.id).where(User.username == username)).one()


def _name() -> str:
    return f"test-{uuid4().hex[:8]}"


def _post(client, headers, channel_id, body, **extra):
    return client.post(COMMENTS, json={"resource_type": "chat_channel", "resource_id": channel_id,
                                       "body": body, **extra}, headers=headers)


def test_chat_needs_a_bearer_token(client):
    assert client.get(CHANNELS).status_code == 401
    assert client.post(f"{PREFIX}/api/chat/direct", json={}).status_code == 401


@pytest.mark.database
def test_a_channel_is_created_with_its_owner_and_members(client, people, live_calls):
    for name in ("admin", "manager"):
        client.get(CHANNELS, headers=people[name])
    name = _name()
    created = client.post(CHANNELS, json={"name": f"#{name.upper()} ", "topic": "Launch plan",
                                          "member_ids": [str(_user_id("manager"))]},
                          headers=people["admin"])
    assert created.status_code == 201, created.get_json()
    channel = created.get_json()
    assert channel["name"] == name
    assert channel["topic"] == "Launch plan"
    assert channel["visibility"] == "PUBLIC"
    assert {member["role"] for member in channel["members"]} == {"OWNER", "MEMBER"}
    assert channel["can_manage"] is True and channel["can_post"] is True
    assert any(call[0] == "*" and call[1]["type"] == "chat.channel" for call in live_calls)

    duplicate = client.post(CHANNELS, json={"name": name}, headers=people["manager"])
    assert duplicate.status_code == 409

    listing = client.get(CHANNELS, headers=people["manager"]).get_json()
    mine = next(item for item in listing["items"] if item["id"] == channel["id"])
    assert mine["is_member"] is True and mine["member_count"] == 2


@pytest.mark.database
@pytest.mark.parametrize("payload, field", [
    ({"name": "   "}, "name"),
    ({"name": "x" * 90}, "name"),
    ({"name": "ok-name", "visibility": "SECRET"}, "visibility"),
    ({"name": "ok-name", "topic": "t" * 300}, "topic"),
    ({"name": "ok-name", "member_ids": "nobody"}, "member_ids"),
])
def test_a_channel_that_makes_no_sense_is_refused(client, people, payload, field):
    response = client.post(CHANNELS, json=payload, headers=people["admin"])
    assert response.status_code == 400
    assert response.get_json()["details"]["field"] == field


@pytest.mark.database
def test_adding_somebody_who_does_not_exist_is_not_found(client, people):
    response = client.post(CHANNELS, json={"name": _name(), "member_ids": [str(uuid4())]},
                           headers=people["admin"])
    assert response.status_code == 404


@pytest.mark.database
def test_a_private_channel_is_invisible_to_whoever_is_not_in_it(client, people, live_calls):
    client.get(CHANNELS, headers=people["user"])
    private = client.post(CHANNELS, json={"name": _name(), "visibility": "PRIVATE"},
                          headers=people["admin"]).get_json()

    listing = client.get(CHANNELS, headers=people["user"]).get_json()
    assert private["id"] not in {item["id"] for item in listing["items"]}
    assert client.get(f"{CHANNELS}/{private['id']}", headers=people["user"]).status_code == 404
    assert client.get(f"{COMMENTS}?resource_type=chat_channel&resource_id={private['id']}",
                      headers=people["user"]).status_code == 404
    assert _post(client, people["user"], private["id"], "hello?").status_code == 404
    # Only the members hear a private room change.
    assert all(call[0] != "*" for call in live_calls if call[1].get("channel_id") == private["id"])


@pytest.mark.database
def test_posting_in_a_public_channel_joins_it_and_counts_as_unread_for_the_others(
    client, people, live_calls
):
    client.get(CHANNELS, headers=people["operator"])
    channel = client.post(CHANNELS, json={"name": _name(), "member_ids": [str(_user_id("manager"))]},
                          headers=people["admin"]).get_json()

    posted = _post(client, people["operator"], channel["id"], "Morning — anything for me?")
    assert posted.status_code == 201, posted.get_json()
    detail = client.get(f"{CHANNELS}/{channel['id']}", headers=people["operator"]).get_json()
    assert detail["is_member"] is True

    _post(client, people["admin"], channel["id"], "@Mara Manager can you take the vendor call?")

    for_manager = client.get(CHANNELS, headers=people["manager"]).get_json()
    row = next(item for item in for_manager["items"] if item["id"] == channel["id"])
    assert row["unread"] == 2
    assert row["mentions"] == 1
    assert row["last_message"]["body"].startswith("@Mara Manager")
    assert for_manager["unread_total"] >= 2
    counts = client.get(f"{PREFIX}/notifications/counts", headers=people["manager"]).get_json()
    assert counts["chat_unread"] >= 2, "the Chat menu badge rides on the notification poll"

    # The author has read everything up to their own line — the operator's
    # earlier one included.
    for_admin = client.get(CHANNELS, headers=people["admin"]).get_json()
    assert next(item for item in for_admin["items"] if item["id"] == channel["id"])["unread"] == 0

    # The live hint names the conversation and reaches its members only.
    hints = [call for call in live_calls if call[1].get("type") == "thread"]
    assert hints and {call[0] for call in hints} <= {str(_user_id(name)) for name in ("admin", "manager", "operator")}

    read = client.post(f"{COMMENTS}/read", json={"resource_type": "chat_channel", "resource_id": channel["id"]},
                       headers=people["manager"])
    assert read.status_code == 200
    after = client.get(CHANNELS, headers=people["manager"]).get_json()
    assert next(item for item in after["items"] if item["id"] == channel["id"])["unread"] == 0

    from src.core.db import session_scope
    from src.services import chat

    with session_scope() as session:
        assert chat.unread_total(session, _user_id("manager")) >= 0


@pytest.mark.database
def test_a_mention_in_a_channel_notifies_the_person_named(client, people, live_calls):
    from src.core.db import session_scope
    from src.models.platform import Notification

    channel = client.post(CHANNELS, json={"name": _name()}, headers=people["admin"]).get_json()
    message = _post(client, people["admin"], channel["id"], "@Otto Operator please look").get_json()
    assert message["mentions"] == [str(_user_id("operator"))]

    with session_scope() as session:
        rows = session.scalars(select(Notification).where(
            Notification.user_id == _user_id("operator"),
            Notification.resource_id == channel["id"],
        )).all()
        assert len(rows) == 1
        assert rows[0].category == "MENTION"
        assert rows[0].link == f"/chat/{channel['id']}"
        assert "mentioned you in #" in rows[0].title

    # An edit that keeps the mention does not notify twice; one that adds a
    # person notifies only them.
    client.put(f"{COMMENTS}/{message['id']}",
               json={"body": "@Otto Operator please look, and @Ana Analyst too"}, headers=people["admin"])
    with session_scope() as session:
        assert session.scalar(select(Notification.id).where(
            Notification.user_id == _user_id("analyst"), Notification.resource_id == channel["id"])) is not None
        assert len(session.scalars(select(Notification).where(
            Notification.user_id == _user_id("operator"), Notification.resource_id == channel["id"])).all()) == 1


@pytest.mark.database
def test_a_picked_mention_with_a_long_name_is_still_resolved(client, people, monkeypatch):
    from src.services import comments

    channel = client.post(CHANNELS, json={"name": _name()}, headers=people["admin"]).get_json()
    operator = str(_user_id("operator"))
    posted = _post(client, people["admin"], channel["id"], "@Otto Operator", mention_ids=[operator])
    assert posted.get_json()["mentions"] == [operator]
    # A picked id whose name is no longer in the text is not a mention.
    from src.core.db import session_scope

    with session_scope() as session:
        assert comments._mentioned(session, "nobody named here", [operator]) == []


@pytest.mark.database
def test_reactions_toggle_and_only_offered_ones_are_accepted(client, people, live_calls):
    channel = client.post(CHANNELS, json={"name": _name()}, headers=people["admin"]).get_json()
    message = _post(client, people["admin"], channel["id"], "Shipped!").get_json()
    url = f"{COMMENTS}/{message['id']}/reactions"

    first = client.post(url, json={"emoji": "🎉"}, headers=people["admin"]).get_json()
    assert first["reactions"] == [{"emoji": "🎉", "count": 1, "mine": True, "people": ["Ada Administrator"]}]
    second = client.post(url, json={"emoji": "🎉"}, headers=people["manager"]).get_json()
    assert second["reactions"][0]["count"] == 2 and second["reactions"][0]["mine"] is True
    undone = client.post(url, json={"emoji": "🎉"}, headers=people["admin"]).get_json()
    assert undone["reactions"][0]["count"] == 1 and undone["reactions"][0]["mine"] is False
    client.post(url, json={"emoji": "🎉"}, headers=people["manager"])
    gone = client.get(f"{COMMENTS}?resource_type=chat_channel&resource_id={channel['id']}",
                      headers=people["admin"]).get_json()
    assert gone["items"][0]["reactions"] == []
    assert "🎉" in gone["reactions"]

    refused = client.post(url, json={"emoji": "<script>"}, headers=people["admin"])
    assert refused.status_code == 400
    assert client.post(f"{COMMENTS}/{uuid4()}/reactions", json={"emoji": "👍"},
                       headers=people["admin"]).status_code == 404
    assert any(call[1].get("action") == "reaction" for call in live_calls)


@pytest.mark.database
def test_replies_are_read_as_a_thread_and_counted_on_their_parent(client, people, live_calls):
    channel = client.post(CHANNELS, json={"name": _name()}, headers=people["admin"]).get_json()
    parent = _post(client, people["admin"], channel["id"], "Release at five?").get_json()
    _post(client, people["manager"], channel["id"], "Yes", parent_id=parent["id"])
    _post(client, people["operator"], channel["id"], "Fine by me", parent_id=parent["id"])

    window = client.get(f"{COMMENTS}?resource_type=chat_channel&resource_id={channel['id']}&limit=20",
                        headers=people["admin"]).get_json()
    assert [item["body"] for item in window["items"]] == ["Release at five?"]
    assert window["items"][0]["reply_count"] == 2
    assert window["items"][0]["last_reply_at"] is not None

    thread = client.get(
        f"{COMMENTS}?resource_type=chat_channel&resource_id={channel['id']}&parent_id={parent['id']}",
        headers=people["admin"],
    ).get_json()
    assert [item["body"] for item in thread["items"]] == ["Yes", "Fine by me"]


@pytest.mark.database
def test_a_long_channel_is_read_newest_first_in_windows(client, people, live_calls):
    channel = client.post(CHANNELS, json={"name": _name()}, headers=people["admin"]).get_json()
    for index in range(5):
        _post(client, people["admin"], channel["id"], f"line {index}")
    base = f"{COMMENTS}?resource_type=chat_channel&resource_id={channel['id']}"

    latest = client.get(f"{base}&limit=2", headers=people["admin"]).get_json()
    assert [item["body"] for item in latest["items"]] == ["line 3", "line 4"]
    assert latest["has_more"] is True
    older = client.get(f"{base}&limit=10&before={latest['items'][0]['created_at']}",
                       headers=people["admin"]).get_json()
    assert [item["body"] for item in older["items"]] == ["line 0", "line 1", "line 2"]
    assert older["has_more"] is False

    assert client.get(f"{base}&limit=many", headers=people["admin"]).status_code == 400
    assert client.get(f"{base}&limit=5&before=yesterday", headers=people["admin"]).status_code == 400


@pytest.mark.database
def test_read_receipts_name_who_has_seen_the_conversation(client, people, live_calls):
    channel = client.post(CHANNELS, json={"name": _name(), "member_ids": [str(_user_id("manager"))]},
                          headers=people["admin"]).get_json()
    _post(client, people["admin"], channel["id"], "Read me")
    client.post(f"{COMMENTS}/read", json={"resource_type": "chat_channel", "resource_id": channel["id"]},
                headers=people["manager"])

    thread = client.get(f"{COMMENTS}?resource_type=chat_channel&resource_id={channel['id']}",
                        headers=people["admin"]).get_json()
    assert [item["name"] for item in thread["reads"]] == ["Mara Manager"]
    assert thread["my_last_read_at"] is not None
    assert any(call[1]["type"] == "thread.read" for call in live_calls)


@pytest.mark.database
def test_typing_is_said_to_the_others_and_never_stored(client, people, live_calls):
    channel = client.post(CHANNELS, json={"name": _name(), "member_ids": [str(_user_id("manager"))]},
                          headers=people["admin"]).get_json()
    live_calls.clear()
    response = client.post(f"{COMMENTS}/typing",
                           json={"resource_type": "chat_channel", "resource_id": channel["id"]},
                           headers=people["admin"])
    assert response.status_code == 200
    assert [call[0] for call in live_calls] == [str(_user_id("manager"))]
    assert live_calls[0][1]["user"]["name"] == "Ada Administrator"


@pytest.mark.database
def test_a_record_thread_is_announced_to_everybody_as_a_hint(client, people, live_calls):
    """A record's conversation has no member list; the hint carries only ids."""
    created = client.post(f"{PREFIX}/api/records/task", json={"title": "Chat hint fixture"},
                          headers=people["admin"]).get_json()
    try:
        live_calls.clear()
        client.post(f"{COMMENTS}/typing", json={"resource_type": "task", "resource_id": created["id"]},
                    headers=people["admin"])
        posted = client.post(COMMENTS, json={"resource_type": "task", "resource_id": created["id"],
                                             "body": "@Mara Manager have a look"}, headers=people["admin"])
        assert posted.status_code == 201
        hints = [call for call in live_calls if call[1]["type"] in ("typing", "thread")]
        assert {call[0] for call in hints} == {"*"}
        assert {call[1]["type"] for call in hints} == {"typing", "thread"}
        # The mention itself is a notification, to the person named only.
        notes = [call for call in live_calls if call[1]["type"] == "notification"]
        assert [call[0] for call in notes] == [str(_user_id("manager"))]
    finally:
        from src.core.db import session_scope
        from src.models.business import Task
        from src.models.content import Comment

        with session_scope() as session:
            session.query(Comment).filter(Comment.resource_id == created["id"]).delete()
            session.query(Task).filter(Task.id == created["id"]).delete()


@pytest.mark.database
def test_a_direct_conversation_is_found_rather_than_made_twice(client, people, live_calls):
    client.get(CHANNELS, headers=people["analyst"])
    analyst = str(_user_id("analyst"))
    first = client.post(f"{PREFIX}/api/chat/direct", json={"user_id": analyst}, headers=people["admin"])
    assert first.status_code == 200
    dm = first.get_json()
    assert dm["kind"] == "DIRECT" and dm["name"] == "Ana Analyst"
    assert dm["other"]["id"] == analyst
    again = client.post(f"{PREFIX}/api/chat/direct", json={"user_id": str(_user_id("admin"))},
                        headers=people["analyst"]).get_json()
    assert again["id"] == dm["id"]
    assert again["can_manage"] is False

    # Nobody else can read it, and it cannot be renamed, left or joined by others.
    assert client.get(f"{CHANNELS}/{dm['id']}", headers=people["user"]).status_code == 404
    assert client.post(f"{CHANNELS}/{dm['id']}/leave", headers=people["admin"]).status_code == 400
    assert client.put(f"{CHANNELS}/{dm['id']}", json={"name": "x"}, headers=people["admin"]).status_code == 403
    assert client.post(f"{CHANNELS}/{dm['id']}/members", json={"member_ids": []},
                       headers=people["admin"]).status_code == 400
    assert _post(client, people["analyst"], dm["id"], "", attachment_ids=[]).status_code == 400

    with_preview = _post(client, people["analyst"], dm["id"], "Got a minute?")
    assert with_preview.status_code == 201
    listing = client.get(CHANNELS, headers=people["admin"]).get_json()
    row = next(item for item in listing["items"] if item["id"] == dm["id"])
    assert row["name"] == "Ana Analyst" and row["unread"] == 1


@pytest.mark.database
def test_the_owner_renames_archives_and_manages_members(client, people, live_calls):
    for name in ("manager", "operator"):
        client.get(CHANNELS, headers=people[name])
    channel = client.post(CHANNELS, json={"name": _name(), "visibility": "PRIVATE"},
                          headers=people["manager"]).get_json()
    url = f"{CHANNELS}/{channel['id']}"
    operator = str(_user_id("operator"))

    added = client.post(f"{url}/members", json={"member_ids": [operator]}, headers=people["manager"])
    assert added.status_code == 200
    assert operator in {member["id"] for member in added.get_json()["members"]}

    # A member who is not the owner may add people but not rename or remove.
    assert client.put(url, json={"topic": "x"}, headers=people["operator"]).status_code == 403
    assert client.delete(f"{url}/members/{operator}", headers=people["operator"]).status_code == 403
    muted = client.put(url, json={"muted": True}, headers=people["operator"])
    assert muted.status_code == 403

    renamed = client.put(url, json={"name": f"{channel['name']}-2", "topic": "New topic", "muted": True},
                         headers=people["manager"]).get_json()
    assert renamed["name"].endswith("-2") and renamed["topic"] == "New topic" and renamed["muted"] is True

    removed = client.delete(f"{url}/members/{operator}", headers=people["manager"])
    assert operator not in {member["id"] for member in removed.get_json()["members"]}
    assert client.delete(f"{url}/members/{operator}", headers=people["manager"]).status_code == 404

    other = client.post(CHANNELS, json={"name": _name()}, headers=people["manager"]).get_json()
    assert client.put(url, json={"name": other["name"]}, headers=people["manager"]).status_code == 409

    assert client.delete(url, headers=people["manager"]).get_json()["archived"] is True
    assert _post(client, people["manager"], channel["id"], "anyone?").status_code == 409
    listing = client.get(CHANNELS, headers=people["manager"]).get_json()
    assert channel["id"] not in {item["id"] for item in listing["items"]}


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
    from src.services import presence

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
