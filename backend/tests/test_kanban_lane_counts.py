"""Kanban boards (§18). — lane counts."""

from __future__ import annotations

import pytest

from tests.kanban_support import (  # noqa: F401
    BOARDS,
    PREFIX,
    _authenticate,
    _board,
    _card,
    _open,
)


@pytest.mark.database
def test_the_lane_counts_are_the_whole_match_not_the_slice(client, monkeypatch):
    """"In progress (12)" must mean twelve of the cards this reader asked
    about, not twelve of the ones that fitted on screen (§71)."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lanes = _open(client, headers, created["id"])["lanes"]
    lane = lanes[0]

    for index in range(3):
        _card(
            client, headers, created["id"], title=f"Filter me {index}",
            lane_id=lane["id"], labels=["backend"] if index else [],
        )

    narrowed = client.get(
        f"{BOARDS}/{created['id']}?label=backend", headers=headers
    ).get_json()
    counted = next(item for item in narrowed["lanes"] if item["id"] == lane["id"])
    assert counted["total"] == 2
    assert len(counted["cards"]) == 2
    # And the filter menu offers what is on the board rather than a text box
    # that matches nothing.
    assert "backend" in narrowed["labels"]


@pytest.mark.database
def test_a_colleague_reads_a_shared_board_and_cannot_rearrange_it(client, monkeypatch):
    """§5: shared means readable, and only the owner writes."""
    owner = _authenticate(monkeypatch)
    created = _board(client, owner, name="Shared plan", scope="PUBLIC")
    lane = _open(client, owner, created["id"])["lanes"][0]
    card = _card(client, owner, created["id"], lane_id=lane["id"])

    colleague = _authenticate(monkeypatch, "manager", "manager")
    readable = client.get(f"{BOARDS}/{created['id']}", headers=colleague)
    assert readable.status_code == 200
    assert readable.get_json()["board"]["can_edit"] is False

    refused = client.post(
        f"{PREFIX}/api/kanban/cards/{card['id']}/move",
        json={"lane_id": lane["id"], "position": 0},
        headers=colleague,
    )
    assert refused.status_code == 403


@pytest.mark.database
def test_a_private_board_is_invisible_to_everybody_else(client, monkeypatch):
    owner = _authenticate(monkeypatch)
    created = _board(client, owner, name="Mine alone", scope="PRIVATE")

    colleague = _authenticate(monkeypatch, "manager", "manager")
    listed = client.get(BOARDS, headers=colleague).get_json()
    assert created["id"] not in {item["id"] for item in listed["items"]}
    # 404 rather than 403: saying a board exists but is not yours is itself a
    # disclosure about who is working on what.
    assert client.get(f"{BOARDS}/{created['id']}", headers=colleague).status_code == 404


@pytest.mark.database
def test_a_move_is_on_the_cards_own_history(client, monkeypatch):
    """A board without a trail is a board where nobody can say who moved it."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lanes = _open(client, headers, created["id"])["lanes"]
    card = _card(client, headers, created["id"])

    client.post(
        f"{PREFIX}/api/kanban/cards/{card['id']}/move",
        json={"lane_id": lanes[2]["id"], "position": 0},
        headers=headers,
    )

    trail = client.get(
        f"{PREFIX}/api/audit/timeline?resource_type=kanban_card&resource_id={card['id']}",
        headers=headers,
    ).get_json()
    actions = [item["action"] for item in trail["items"]]
    assert "STATUS_CHANGE" in actions
    assert "CREATE" in actions


@pytest.mark.database
def test_a_card_can_be_talked_about_and_the_board_decides_who_may(client, monkeypatch):
    """The conversation is the polymorphic one every record has (§36).

    A card is not an explorer resource — it has no field catalogue, and giving
    it one to unlock comments would put board cards in the query builder and
    the export. So `services/comments.COMMENTABLE` says which rule authorises
    it, and the rule is the board's own visibility.
    """
    owner = _authenticate(monkeypatch)
    created = _board(client, owner, name="Talkable", scope="PRIVATE")
    card = _card(client, owner, created["id"])

    posted = client.post(
        f"{PREFIX}/api/comments",
        json={"resource_type": "kanban_card", "resource_id": card["id"], "body": "Worth doing."},
        headers=owner,
    )
    assert posted.status_code == 201, posted.get_data(as_text=True)

    listed = client.get(
        f"{PREFIX}/api/comments?resource_type=kanban_card&resource_id={card['id']}",
        headers=owner,
    ).get_json()
    assert [item["body"] for item in listed["items"]] == ["Worth doing."]

    # And a colleague who cannot see the board cannot see the conversation
    # either: 404, because saying a card exists is itself a disclosure.
    colleague = _authenticate(monkeypatch, "manager", "manager")
    refused = client.get(
        f"{PREFIX}/api/comments?resource_type=kanban_card&resource_id={card['id']}",
        headers=colleague,
    )
    assert refused.status_code == 404


@pytest.mark.database
def test_a_cards_face_says_how_much_has_been_said_on_it(client, monkeypatch):
    """The count on the tile, counted once for the whole board (§18).

    "Two comments" is often the reason to open one card rather than the next,
    and a tile that cannot say so makes the reader open all of them. The count
    comes back with the board — one `GROUP BY` over the polymorphic table —
    because asking per card is forty queries for a picture of one board.
    """
    owner = _authenticate(monkeypatch)
    created = _board(client, owner, name="Chatty", scope="PRIVATE")
    quiet = _card(client, owner, created["id"], title="Nobody has said anything")
    busy = _card(client, owner, created["id"], title="Two people have")

    for body in ("First thought.", "Second thought."):
        posted = client.post(
            f"{PREFIX}/api/comments",
            json={"resource_type": "kanban_card", "resource_id": busy["id"], "body": body},
            headers=owner,
        )
        assert posted.status_code == 201, posted.get_data(as_text=True)

    board = client.get(f"{PREFIX}/api/kanban/boards/{created['id']}", headers=owner).get_json()
    counted = {
        card["id"]: card["comment_count"]
        for lane in board["lanes"]
        for card in lane["cards"]
    }
    assert counted[busy["id"]] == 2
    # Zero rather than absent: a tile deciding between "none" and "unknown"
    # would draw the chip for a card nobody has commented on.
    assert counted[quiet["id"]] == 0

    # A withdrawn comment stops counting, because the deleted ones are still
    # rows and a count that included them would say two where one is readable.
    listed = client.get(
        f"{PREFIX}/api/comments?resource_type=kanban_card&resource_id={busy['id']}",
        headers=owner,
    ).get_json()
    client.delete(f"{PREFIX}/api/comments/{listed['items'][0]['id']}", headers=owner)
    again = client.get(f"{PREFIX}/api/kanban/boards/{created['id']}", headers=owner).get_json()
    assert [
        card["comment_count"]
        for lane in again["lanes"]
        for card in lane["cards"]
        if card["id"] == busy["id"]
    ] == [1]


@pytest.mark.database
def test_an_unknown_commentable_kind_is_still_refused(client, monkeypatch):
    """The registry widened what may be commented on; it must not have opened
    the door to anything at all."""
    headers = _authenticate(monkeypatch)
    refused = client.get(
        f"{PREFIX}/api/comments?resource_type=unicorn"
        f"&resource_id=00000000-0000-0000-0000-000000000000",
        headers=headers,
    )
    assert refused.status_code == 400
    assert "Unknown explorer resource" in refused.get_json()["message"]


@pytest.mark.database
def test_a_reused_board_key_does_not_collide_with_the_old_boards_cards(client, monkeypatch):
    """Found by the end-to-end suite as a 500 on the first card of a new board.

    A reference is globally unique so it can be quoted without naming the
    board. A key used to be freed when a board was deleted, so the next board
    with that name started numbering at 1 — and its first card collided with
    the deleted board's `PLAT-00001`.
    """
    headers = _authenticate(monkeypatch)
    first = _board(client, headers, name="Platform delivery")
    key = first["key"]
    original = _card(client, headers, first["id"], title="The first one")
    assert original["reference"] == f"{key}-00001"

    assert client.delete(f"{BOARDS}/{first['id']}", headers=headers).status_code == 200

    # A new board cannot take the key back at all — two boards sharing one key
    # across time would interleave their references.
    second = _board(client, headers, name="Platform delivery")
    assert second["key"] != key

    # And even asked for it directly, the numbering continues rather than
    # restarting: the old board's references are spent.
    third = _board(client, headers, name="Anything", key=key)
    assert third["key"] != key
