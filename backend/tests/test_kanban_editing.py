"""Kanban boards (§18): the edits the drag-and-drop tests do not reach.

`test_kanban` asserts the invariants of a drop. These are the forms around it:
renaming and archiving a board, the lane settings, every field of a card, and
the filters that narrow a board — each with the refusal that protects it.
"""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
API = f"{PREFIX}/api/kanban"
BOARDS = f"{API}/boards"

pytestmark = pytest.mark.database


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"kanban-edit-{username}"),
    )
    return {"Authorization": f"Bearer kanban-edit-{username}"}


def _board(client, headers, **overrides):
    payload = {"name": "Editing board", "scope": "PRIVATE"}
    payload.update(overrides)
    response = client.post(BOARDS, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _open(client, headers, board_id, **params):
    response = client.get(f"{BOARDS}/{board_id}", query_string=params, headers=headers)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _card(client, headers, board_id, **overrides):
    payload = {"title": "A piece of work", "kind": "TASK"}
    payload.update(overrides)
    response = client.post(f"{BOARDS}/{board_id}/cards", json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _titles(body) -> set[str]:
    return {card["title"] for lane in body["lanes"] for card in lane["cards"]}


def _me(client, headers) -> str:
    return client.get(f"{PREFIX}/api/me", headers=headers).get_json()["user"]["id"]


def test_a_board_can_be_renamed_archived_and_deleted(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers, description="first")

    blank = client.put(f"{BOARDS}/{board['id']}", json={"name": "  "}, headers=headers)
    assert blank.status_code == 400

    changed = client.put(
        f"{BOARDS}/{board['id']}",
        json={
            "name": "Renamed board",
            "description": "  ",
            "is_archived": True,
            "scope": "PRIVATE",
            "member_ids": [],
        },
        headers=headers,
    )
    assert changed.status_code == 200, changed.get_data(as_text=True)
    body = changed.get_json()
    assert body["name"] == "Renamed board"
    assert body["is_archived"] is True

    removed = client.delete(f"{BOARDS}/{board['id']}", headers=headers)
    assert removed.status_code == 200
    assert removed.get_json()["deleted"] is True
    assert client.get(f"{BOARDS}/{board['id']}", headers=headers).status_code == 404


def test_a_board_needs_a_name(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    assert client.post(BOARDS, json={"name": ""}, headers=headers).status_code == 400
    assert client.post(BOARDS, json=["not", "an", "object"], headers=headers).status_code == 400


def test_lanes_are_named_limited_and_have_one_done(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers)

    assert (
        client.post(f"{BOARDS}/{board['id']}/lanes", json={"name": ""}, headers=headers).status_code
        == 400
    )
    created = client.post(
        f"{BOARDS}/{board['id']}/lanes",
        json={"name": "Shipped", "is_done": True, "wip_limit": "3"},
        headers=headers,
    )
    assert created.status_code == 201, created.get_data(as_text=True)
    lane = created.get_json()
    assert lane["is_done"] is True and lane["wip_limit"] == 3

    lanes = _open(client, headers, board["id"])["lanes"]
    assert [item["is_done"] for item in lanes].count(True) == 1

    other = lanes[0]
    bad_limit = client.put(
        f"{API}/lanes/{other['id']}", json={"wip_limit": "lots"}, headers=headers
    )
    assert bad_limit.status_code == 400
    assert (
        client.put(f"{API}/lanes/{other['id']}", json={"name": " "}, headers=headers).status_code
        == 400
    )
    renamed = client.put(
        f"{API}/lanes/{other['id']}",
        json={"name": "Inbox", "wip_limit": "", "is_done": True},
        headers=headers,
    )
    assert renamed.status_code == 200
    assert renamed.get_json()["name"] == "Inbox"
    after = _open(client, headers, board["id"])["lanes"]
    done = [item["id"] for item in after if item["is_done"]]
    assert done == [other["id"]], "moving 'done' clears it from the previous lane"

    # And it can be switched off again.
    cleared = client.put(f"{API}/lanes/{other['id']}", json={"is_done": False}, headers=headers)
    assert cleared.get_json()["is_done"] is False


def test_a_lane_deleted_with_a_named_destination_sends_its_cards_there(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers)
    lanes = _open(client, headers, board["id"])["lanes"]
    source, target = lanes[0], lanes[-1]
    _card(client, headers, board["id"], title="Travelling", lane_id=source["id"])

    wrong = client.delete(
        f"{API}/lanes/{source['id']}",
        query_string={"move_to": "00000000-0000-0000-0000-000000000000"},
        headers=headers,
    )
    assert wrong.status_code == 400

    moved = client.delete(
        f"{API}/lanes/{source['id']}", query_string={"move_to": target["id"]}, headers=headers
    )
    assert moved.status_code == 200, moved.get_data(as_text=True)
    after = _open(client, headers, board["id"])
    destination = next(lane for lane in after["lanes"] if lane["id"] == target["id"])
    assert "Travelling" in {card["title"] for card in destination["cards"]}


def test_the_lane_order_must_name_every_lane(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers)
    lanes = _open(client, headers, board["id"])["lanes"]
    url = f"{BOARDS}/{board['id']}/lanes"

    assert client.put(url, json={"lane_ids": []}, headers=headers).status_code == 400
    assert client.put(url, json={"lane_ids": [lanes[0]["id"]]}, headers=headers).status_code == 400
    reversed_ids = [lane["id"] for lane in reversed(lanes)]
    applied = client.put(url, json={"lane_ids": reversed_ids}, headers=headers)
    assert applied.status_code == 200
    assert [lane["id"] for lane in applied.get_json()["lanes"]] == reversed_ids


def test_every_field_of_a_card_can_be_changed_and_validated(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers)
    me = _me(client, headers)
    epic = _card(client, headers, board["id"], title="The epic", kind="EPIC")
    story = _card(client, headers, board["id"], title="The story", kind="STORY", parent_id=epic["id"])
    card = _card(client, headers, board["id"], title="Editable")
    url = f"{API}/cards/{card['id']}"

    refusals = [
        {"title": ""},
        {"kind": "SAGA"},
        {"priority": "WHENEVER"},
        {"labels": "not-a-list"},
        {"checklist": "not-a-list"},
        {"checklist": ["not-an-object"]},
        {"assignee_id": "not-a-uuid"},
        {"parent_id": "00000000-0000-0000-0000-000000000000"},
        {"parent_id": epic["id"]},  # an epic holds stories, not tasks
        {"due_date": "the thirty-first"},
    ]
    for payload in refusals:
        response = client.put(url, json=payload, headers=headers)
        assert response.status_code == 400, (payload, response.get_data(as_text=True))

    changed = client.put(
        url,
        json={
            "title": "Edited",
            "description": "  detail  ",
            "priority": "HIGH",
            "story_points": 5,
            "assignee_id": me,
            "labels": ["ux", " ux ", "", "backend"],
            "due_date": "2030-01-31",
            "checklist": [{"text": "first", "done": True}, {"text": "  "}, {"text": "second"}],
            "parent_id": story["id"],
        },
        headers=headers,
    )
    assert changed.status_code == 200, changed.get_data(as_text=True)
    body = changed.get_json()
    assert body["title"] == "Edited"
    assert body["labels"] == ["backend", "ux"]
    assert body["priority"] == "HIGH"
    assert body["parent_id"] == story["id"]
    assert body["due_date"] == "2030-01-31"
    assert body["checklist_done"] == 1 and len(body["checklist"]) == 2

    # Changing kind re-checks the parent: a story may not hold a story.
    assert client.put(url, json={"kind": "STORY"}, headers=headers).status_code == 400
    # Unparented, it may become anything that has no parent requirement.
    assert client.put(url, json={"parent_id": None}, headers=headers).status_code == 200
    assert client.put(url, json={"kind": "BUG"}, headers=headers).status_code == 200

    detail = client.get(url, headers=headers).get_json()
    assert detail["can_edit"] is True
    assert {option["id"] for option in detail["parent_options"]} >= {story["id"]}

    removed = client.delete(url, headers=headers)
    assert removed.status_code == 200
    assert client.get(url, headers=headers).status_code == 404


def test_a_card_is_created_only_where_it_belongs(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers)
    cards = f"{BOARDS}/{board['id']}/cards"
    assert client.post(cards, json={"title": ""}, headers=headers).status_code == 400
    assert client.post(cards, json={"title": "x", "kind": "SAGA"}, headers=headers).status_code == 400
    assert (
        client.post(
            cards,
            json={"title": "x", "lane_id": "00000000-0000-0000-0000-000000000000"},
            headers=headers,
        ).status_code
        == 400
    )
    epic = _card(client, headers, board["id"], kind="EPIC", title="E")
    # An epic has no possible parents.
    assert client.get(f"{API}/cards/{epic['id']}", headers=headers).get_json()["parent_options"] == []


def test_a_card_created_with_a_due_date_says_which_day(client, monkeypatch):
    """Regression: the raw string reached the `Date` column and the reply was a 500."""
    headers = _authenticate(monkeypatch)
    board = _board(client, headers)
    card = _card(client, headers, board["id"], due_date="2031-06-15")
    assert card["due_date"] == "2031-06-15"
    refused = client.post(
        f"{BOARDS}/{board['id']}/cards",
        json={"title": "x", "due_date": "2031-13-45"},
        headers=headers,
    )
    assert refused.status_code == 400


def test_a_move_needs_an_integer_position(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers)
    card = _card(client, headers, board["id"])
    response = client.post(
        f"{API}/cards/{card['id']}/move", json={"position": "top"}, headers=headers
    )
    assert response.status_code == 400


def test_a_board_narrows_by_assignee_label_kind_and_words(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers)
    me = _me(client, headers)
    _card(client, headers, board["id"], title="Mine labelled", assignee_id=me, labels=["ux"])
    _card(client, headers, board["id"], title="A bug nobody owns", kind="BUG")
    _card(client, headers, board["id"], title="Plain", description="needle in here")

    assert _titles(_open(client, headers, board["id"], assignee_id=me)) == {"Mine labelled"}
    assert _titles(_open(client, headers, board["id"], label="ux")) == {"Mine labelled"}
    assert _titles(_open(client, headers, board["id"], kind="bug")) == {"A bug nobody owns"}
    assert _titles(_open(client, headers, board["id"], q="needle")) == {"Plain"}
    bad = client.get(f"{BOARDS}/{board['id']}", query_string={"kind": "SAGA"}, headers=headers)
    assert bad.status_code == 400


def test_unknown_lanes_and_cards_are_not_found(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.put(f"{API}/lanes/{missing}", json={}, headers=headers).status_code == 404
    assert client.get(f"{API}/cards/{missing}", headers=headers).status_code == 404
    assert client.get(f"{BOARDS}/{missing}", headers=headers).status_code == 404
    assert client.get(f"{BOARDS}/not-a-uuid", headers=headers).status_code in (400, 404)


def test_a_colleague_cannot_edit_a_board_they_can_read(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    board = _board(client, headers, scope="PUBLIC", name="Shared for reading")
    lane = _open(client, headers, board["id"])["lanes"][0]
    card = _card(client, headers, board["id"])

    reader = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(f"{BOARDS}/{board['id']}", headers=reader).status_code == 200
    assert client.get(f"{API}/cards/{card['id']}", headers=reader).get_json()["can_edit"] is False
    for response in (
        client.put(f"{BOARDS}/{board['id']}", json={"name": "Mine now"}, headers=reader),
        client.delete(f"{BOARDS}/{board['id']}", headers=reader),
        client.put(f"{API}/lanes/{lane['id']}", json={"name": "x"}, headers=reader),
        client.put(f"{API}/cards/{card['id']}", json={"title": "x"}, headers=reader),
    ):
        assert response.status_code == 403, response.get_data(as_text=True)
