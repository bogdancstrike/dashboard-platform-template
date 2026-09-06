"""Comments on a record (§36), and the card's to-do list (§18).

The comment table is polymorphic, so what is asserted here is mostly that the
*rules* travel with it: reading a conversation needs the record's own
permission, writing needs its own, editing belongs to the author alone and is
marked, and a reply cannot land on a different record than the comment it
answers.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
COMMENTS = f"{PREFIX}/api/comments"
TASKS = f"{PREFIX}/api/records/task"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"comments-{username}"),
    )
    return {"Authorization": f"Bearer comments-{username}"}


def _erase_task(record_id: str) -> None:
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.content import Comment
    from src.models.platform import ActivityEntry

    with session_scope() as session:
        session.query(Comment).filter(
            Comment.resource_type == "task", Comment.resource_id == str(record_id)
        ).delete(synchronize_session=False)
        session.query(ActivityEntry).filter(
            ActivityEntry.resource_type == "task", ActivityEntry.resource_id == str(record_id)
        ).delete(synchronize_session=False)
        session.query(Task).filter(Task.id == record_id).delete(synchronize_session=False)


@pytest.fixture()
def task(client, monkeypatch):
    """A scratch task to talk about, removed with its conversation."""
    headers = _authenticate(monkeypatch)
    created = client.post(TASKS, json={"title": "Comment fixture"}, headers=headers)
    assert created.status_code == 201, created.get_json()
    record = created.get_json()
    try:
        yield record
    finally:
        _erase_task(record["id"])


def test_comments_need_a_bearer_token(client):
    assert client.get(f"{COMMENTS}?resource_type=task&resource_id={uuid4()}").status_code == 401
    assert client.post(COMMENTS, json={"body": "hello"}).status_code == 401


@pytest.mark.database
def test_a_comment_joins_the_record_it_was_made_on(client, monkeypatch, task):
    headers = _authenticate(monkeypatch)

    posted = client.post(
        COMMENTS,
        json={"resource_type": "task", "resource_id": task["id"], "body": "Blocked on the API key."},
        headers=headers,
    )
    assert posted.status_code == 201

    thread = client.get(
        f"{COMMENTS}?resource_type=task&resource_id={task['id']}", headers=headers
    ).get_json()

    assert [item["body"] for item in thread["items"]] == ["Blocked on the API key."]
    assert thread["items"][0]["author"]["name"] == "Ada Administrator"
    assert thread["can_comment"] is True


@pytest.mark.database
def test_an_empty_comment_is_refused(client, monkeypatch, task):
    response = client.post(
        COMMENTS,
        json={"resource_type": "task", "resource_id": task["id"], "body": "   "},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert response.get_json()["details"]["field"] == "body"


@pytest.mark.database
def test_reading_a_record_does_not_carry_the_right_to_annotate_it(client, monkeypatch, task):
    # An analyst reads everything and writes nothing — including comments.
    _authenticate(monkeypatch, "analyst", "analyst")
    headers = {"Authorization": "Bearer comments-analyst"}

    thread = client.get(
        f"{COMMENTS}?resource_type=task&resource_id={task['id']}", headers=headers
    )
    refused = client.post(
        COMMENTS,
        json={"resource_type": "task", "resource_id": task["id"], "body": "May I?"},
        headers=headers,
    )

    assert thread.status_code == 200
    # And the page is told before somebody types, not after (§76).
    assert thread.get_json()["can_comment"] is False
    assert refused.status_code == 403
    assert refused.get_json()["details"]["missing"] == ["records.comment"]


@pytest.mark.database
def test_only_the_author_may_change_what_was_said(client, monkeypatch, task):
    admin = _authenticate(monkeypatch)
    comment = client.post(
        COMMENTS,
        json={"resource_type": "task", "resource_id": task["id"], "body": "Mine."},
        headers=admin,
    ).get_json()

    _authenticate(monkeypatch, "manager", "manager")
    other = {"Authorization": "Bearer comments-manager"}

    assert client.put(f"{COMMENTS}/{comment['id']}", json={"body": "Not yours"},
                      headers=other).status_code == 403
    assert client.delete(f"{COMMENTS}/{comment['id']}", headers=other).status_code == 403


@pytest.mark.database
def test_an_edited_comment_says_that_it_was_edited(client, monkeypatch, task):
    headers = _authenticate(monkeypatch)
    comment = client.post(
        COMMENTS,
        json={"resource_type": "task", "resource_id": task["id"], "body": "First thought."},
        headers=headers,
    ).get_json()
    assert comment["edited_at"] is None

    edited = client.put(
        f"{COMMENTS}/{comment['id']}", json={"body": "Second thought."}, headers=headers
    ).get_json()

    # A comment that can be rewritten with no trace is not a record of a
    # conversation.
    assert edited["body"] == "Second thought."
    assert edited["edited_at"] is not None


@pytest.mark.database
def test_a_reply_cannot_land_on_a_different_record(client, monkeypatch, task):
    from src.core.db import session_scope
    from src.models.business import Ticket

    headers = _authenticate(monkeypatch)
    parent = client.post(
        COMMENTS,
        json={"resource_type": "task", "resource_id": task["id"], "body": "Parent."},
        headers=headers,
    ).get_json()

    with session_scope() as session:
        ticket = session.scalars(select(Ticket).where(Ticket.deleted_at.is_(None)).limit(1)).one()

    response = client.post(
        COMMENTS,
        json={
            "resource_type": "ticket",
            "resource_id": str(ticket.id),
            "parent_id": parent["id"],
            "body": "Answering something from another page.",
        },
        headers=headers,
    )

    assert response.status_code == 400


@pytest.mark.database
def test_a_mention_is_resolved_once_at_write_time(client, monkeypatch, task):
    headers = _authenticate(monkeypatch)

    comment = client.post(
        COMMENTS,
        json={
            "resource_type": "task",
            "resource_id": task["id"],
            "body": "@Mara Manager can you look at this?",
        },
        headers=headers,
    ).get_json()

    # Stored beside the body, so "what am I mentioned in?" is an indexed
    # question rather than a scan that re-parses every comment.
    assert len(comment["mentions"]) == 1


@pytest.mark.database
def test_a_deleted_comment_leaves_the_conversation(client, monkeypatch, task):
    headers = _authenticate(monkeypatch)
    comment = client.post(
        COMMENTS,
        json={"resource_type": "task", "resource_id": task["id"], "body": "Withdrawn."},
        headers=headers,
    ).get_json()

    assert client.delete(f"{COMMENTS}/{comment['id']}", headers=headers).status_code == 200

    thread = client.get(
        f"{COMMENTS}?resource_type=task&resource_id={task['id']}", headers=headers
    ).get_json()
    assert thread["items"] == []


@pytest.mark.database
def test_a_comment_on_a_dataset_that_does_not_exist_is_a_client_error(client, monkeypatch):
    response = client.get(
        f"{COMMENTS}?resource_type=secrets&resource_id={uuid4()}",
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400


# ── the card's to-do list (§18) ──────────────────────────────────────────


@pytest.mark.database
def test_a_checklist_is_written_by_the_same_endpoint_as_everything_else(client, monkeypatch, task):
    headers = _authenticate(monkeypatch)

    body = client.put(
        f"{TASKS}/{task['id']}",
        json={"checklist": [{"text": "Draft the query", "done": True},
                            {"text": "Review it", "done": False}]},
        headers=headers,
    ).get_json()

    stored = next(field["value"] for field in body["fields"] if field["name"] == "checklist")
    # Ticking an item is an edit to the task, not a second kind of write with
    # a second set of rules — so it is audited like any other.
    assert stored == [{"text": "Draft the query", "done": True},
                      {"text": "Review it", "done": False}]


@pytest.mark.database
def test_a_checklist_item_needs_text(client, monkeypatch, task):
    response = client.put(
        f"{TASKS}/{task['id']}", json={"checklist": [{"done": True}]},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert response.get_json()["details"]["field"] == "checklist"


@pytest.mark.database
def test_a_checklist_is_a_list_of_items_not_whatever_arrives(client, monkeypatch, task):
    # A JSONB column that stores anything a client sends is a second,
    # undocumented schema.
    response = client.put(
        f"{TASKS}/{task['id']}", json={"checklist": {"text": "not a list"}},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
