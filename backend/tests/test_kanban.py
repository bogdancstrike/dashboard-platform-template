"""Kanban boards (§18).

The claims worth asserting are the ones that decide whether a board can be
trusted with somebody's work: that a drop leaves the positions dense and
unambiguous, that deleting a lane *moves* its cards rather than losing them,
that the hierarchy rule is enforced in one place, that a WIP limit warns
without refusing, and that a colleague can read a shared board without being
able to rearrange it.
"""

from __future__ import annotations

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
BOARDS = f"{PREFIX}/api/kanban/boards"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"kanban-{username}"),
    )
    return {"Authorization": f"Bearer kanban-{username}"}


def _board(client, headers, **overrides):
    """A board of this test's own, so no test depends on the seed's shape."""
    payload = {"name": "Test board", "scope": "PRIVATE"}
    payload.update(overrides)
    response = client.post(BOARDS, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _open(client, headers, board_id):
    response = client.get(f"{BOARDS}/{board_id}", headers=headers)
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


def _card(client, headers, board_id, **overrides):
    payload = {"title": "A piece of work", "kind": "TASK"}
    payload.update(overrides)
    response = client.post(
        f"{BOARDS}/{board_id}/cards", json=payload, headers=headers
    )
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def test_the_board_endpoints_need_a_bearer_token(client):
    assert client.get(BOARDS).status_code == 401
    assert client.post(BOARDS, json={"name": "x"}).status_code == 401


def test_the_hierarchy_rule_lives_in_one_place():
    """Every kind's children are declared once, and the rule is total.

    Three copies of "can this be dropped on that" is how a board ends up with
    an epic inside a task — and the check happens on create, on re-parent and
    when a parent is deleted.
    """
    from src.services.kanban import KINDS, PARENT_OF

    assert set(PARENT_OF) == set(KINDS)
    # Every child named is itself a kind: a rule that permits a child nothing
    # can be is a rule with a typo in it.
    for parent, children in PARENT_OF.items():
        for child in children:
            assert child in PARENT_OF, f"{parent} may hold {child}, which is not a kind"
    # And nothing holds an epic, which is what makes the tree finite.
    assert not [parent for parent, children in PARENT_OF.items() if "EPIC" in children]


@pytest.mark.database
def test_a_new_board_arrives_with_lanes(client, monkeypatch):
    """A board created empty is a board whose first action is administration."""
    from src.services.kanban import STARTER_LANES

    headers = _authenticate(monkeypatch)
    created = _board(client, headers, name="Delivery")
    body = _open(client, headers, created["id"])

    assert [lane["name"] for lane in body["lanes"]] == [name for name, _ in STARTER_LANES]
    assert [lane["position"] for lane in body["lanes"]] == list(range(len(STARTER_LANES)))
    # Exactly one lane means finished: two would be two answers to "how much
    # have we shipped".
    assert sum(1 for lane in body["lanes"] if lane["is_done"]) == 1


@pytest.mark.database
def test_the_board_key_prefixes_every_reference(client, monkeypatch):
    """`PLAT-00042` is quotable without naming the board."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers, name="Platform delivery")
    key = created["key"]
    # Derived from the name — the initials — rather than asserted as a literal:
    # keys are deduplicated across boards, so "PD" being taken by another
    # board is the *designed* behaviour and a test that demanded it would be
    # asserting that nobody else has ever made a board called anything with
    # those initials.
    assert key.startswith("PD")

    first = _card(client, headers, created["id"], title="One")
    second = _card(client, headers, created["id"], title="Two")
    # Padded, which is what keeps `MAX(reference)` a valid way to find the
    # highest one — one index scan rather than a parse of every row.
    assert first["reference"] == f"{key}-00001"
    assert second["reference"] == f"{key}-00002"


@pytest.mark.database
def test_a_hundredth_board_with_the_same_initials_can_still_be_created(client, monkeypatch):
    """The uniquifying suffix is bounded by the column, not by two digits.

    A key is never freed — not even by deleting the board, because the card
    references of the two would interleave — so the ceiling on one derived key
    is cumulative over the installation's whole life. The earlier version tried
    `KEY2` … `KEY99` and then refused, which is 98 boards, ever. The end-to-end
    suite makes a board with the same name on every run and reached exactly
    that: `EBS99` existed, and every later run could not create a board at all.
    The failure a reader saw was a modal that stayed open.
    """
    from src.core.db import session_scope
    from src.models.kanban import Board

    headers = _authenticate(monkeypatch)
    # The whole space the old bound allowed, filled directly: going through the
    # endpoint a hundred times would assert the same thing in ninety seconds.
    stem = "ZZZ"
    with session_scope() as session:
        session.add(Board(name="Taken", key=stem, scope="PRIVATE"))
        for number in range(2, 100):
            session.add(
                Board(name=f"Taken {number}", key=f"{stem}{number}", scope="PRIVATE")
            )

    created = _board(client, headers, name="Zulu Zebra Zoo")
    # A third digit rather than a refusal, and short enough to store.
    assert created["key"] == f"{stem}100"
    assert len(created["key"]) <= Board.key.type.length

    # And it numbers its own cards from one, under its own key.
    assert _card(client, headers, created["id"], title="One")["reference"] == f"{stem}100-00001"


@pytest.mark.database
def test_a_drop_leaves_the_positions_dense_and_unambiguous(client, monkeypatch):
    """Dense integers, rewritten on a drop.

    A float midpoint avoids the rewrite and drifts into precision nobody can
    debug; this is the property that makes the alternative unnecessary — after
    any move, every card in a lane has a distinct position and they run 0..n.
    """
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lanes = _open(client, headers, created["id"])["lanes"]
    backlog, selected = lanes[0]["id"], lanes[1]["id"]

    cards = [
        _card(client, headers, created["id"], title=f"Card {index}", lane_id=backlog)
        for index in range(4)
    ]
    assert [card["position"] for card in cards] == [0, 1, 2, 3]

    # The last card to the front of the same lane.
    moved = client.post(
        f"{PREFIX}/api/kanban/cards/{cards[3]['id']}/move",
        json={"lane_id": backlog, "position": 0},
        headers=headers,
    )
    assert moved.status_code == 200
    body = _open(client, headers, created["id"])
    lane = next(item for item in body["lanes"] if item["id"] == backlog)
    assert [card["title"] for card in lane["cards"]] == [
        "Card 3", "Card 0", "Card 1", "Card 2",
    ]
    assert [card["position"] for card in lane["cards"]] == [0, 1, 2, 3]

    # And into another lane: the lane it left closes its gap.
    client.post(
        f"{PREFIX}/api/kanban/cards/{cards[0]['id']}/move",
        json={"lane_id": selected, "position": 0},
        headers=headers,
    )
    body = _open(client, headers, created["id"])
    for lane in body["lanes"]:
        positions = [card["position"] for card in lane["cards"]]
        assert positions == list(range(len(positions))), lane["name"]


@pytest.mark.database
def test_arriving_in_the_done_lane_completes_a_card_and_leaving_undoes_it(client, monkeypatch):
    """A board whose `completed_at` disagreed with its columns would report a
    different number from the one on screen."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lanes = _open(client, headers, created["id"])["lanes"]
    done = next(lane for lane in lanes if lane["is_done"])
    card = _card(client, headers, created["id"])

    finished = client.post(
        f"{PREFIX}/api/kanban/cards/{card['id']}/move",
        json={"lane_id": done["id"], "position": 0},
        headers=headers,
    ).get_json()
    assert finished["completed_at"] is not None

    reopened = client.post(
        f"{PREFIX}/api/kanban/cards/{card['id']}/move",
        json={"lane_id": lanes[0]["id"], "position": 0},
        headers=headers,
    ).get_json()
    assert reopened["completed_at"] is None


@pytest.mark.database
def test_deleting_a_lane_moves_its_cards_rather_than_losing_them(client, monkeypatch):
    """Losing somebody's work to a column they were tidying up is the single
    worst thing a board can do."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lanes = _open(client, headers, created["id"])["lanes"]
    doomed = lanes[2]
    cards = [
        _card(client, headers, created["id"], title=f"Kept {index}", lane_id=doomed["id"])
        for index in range(3)
    ]

    removed = client.delete(f"{PREFIX}/api/kanban/lanes/{doomed['id']}", headers=headers)
    assert removed.status_code == 200
    answer = removed.get_json()
    assert answer["moved"] == 3
    # Named, so a reader can be told where their work went.
    assert answer["moved_to"]["name"] == lanes[1]["name"]

    body = _open(client, headers, created["id"])
    assert doomed["id"] not in {lane["id"] for lane in body["lanes"]}
    survivors = {
        card["title"] for lane in body["lanes"] for card in lane["cards"]
    }
    assert {card["title"] for card in cards} <= survivors
    # And nothing is stranded: `unplaced` is for a lane deleted under
    # somebody's feet, not for the ordinary path.
    assert body["unplaced"] == []


@pytest.mark.database
def test_the_last_lane_cannot_be_deleted(client, monkeypatch):
    """Its cards would have nowhere to go, which is the one case the move
    cannot solve."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lanes = _open(client, headers, created["id"])["lanes"]

    for lane in lanes[1:]:
        assert client.delete(
            f"{PREFIX}/api/kanban/lanes/{lane['id']}", headers=headers
        ).status_code == 200

    refused = client.delete(f"{PREFIX}/api/kanban/lanes/{lanes[0]['id']}", headers=headers)
    assert refused.status_code == 409
    assert "at least one lane" in refused.get_json()["message"]


@pytest.mark.database
def test_a_lane_over_its_limit_is_reported_and_never_enforced(client, monkeypatch):
    """A limit somebody set last month must not stop them moving an urgent
    card today — a board that argues gets worked around, in a spreadsheet."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lanes = _open(client, headers, created["id"])["lanes"]
    lane = lanes[2]

    limited = client.put(
        f"{PREFIX}/api/kanban/lanes/{lane['id']}", json={"wip_limit": 1}, headers=headers
    )
    assert limited.status_code == 200

    for index in range(3):
        # Every one of these is accepted. The limit is advice.
        _card(client, headers, created["id"], title=f"Over {index}", lane_id=lane["id"])

    body = _open(client, headers, created["id"])
    reported = next(item for item in body["lanes"] if item["id"] == lane["id"])
    assert reported["wip_limit"] == 1
    assert reported["total"] == 3
    assert reported["over_limit"] is True


@pytest.mark.database
def test_a_limit_of_zero_is_refused_because_it_is_not_a_limit(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lane = _open(client, headers, created["id"])["lanes"][0]

    refused = client.put(
        f"{PREFIX}/api/kanban/lanes/{lane['id']}", json={"wip_limit": 0}, headers=headers
    )
    assert refused.status_code == 400
    assert "at least 1" in refused.get_json()["message"]


@pytest.mark.database
def test_a_story_cannot_be_hung_off_a_task(client, monkeypatch):
    """The rule is stated once and the refusal says which pairing it was."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    task = _card(client, headers, created["id"], kind="TASK", title="A task")

    refused = client.post(
        f"{BOARDS}/{created['id']}/cards",
        json={"title": "A story", "kind": "STORY", "parent_id": task["id"]},
        headers=headers,
    )
    assert refused.status_code == 400
    assert "cannot hold" in refused.get_json()["message"]
    assert refused.get_json()["details"]["parent"] == "TASK"


@pytest.mark.database
def test_an_epic_holds_a_story_and_a_story_holds_a_task(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    epic = _card(client, headers, created["id"], kind="EPIC", title="An epic")
    story = _card(
        client, headers, created["id"], kind="STORY", title="A story", parent_id=epic["id"]
    )
    task = _card(
        client, headers, created["id"], kind="TASK", title="A task", parent_id=story["id"]
    )

    body = client.get(f"{PREFIX}/api/kanban/cards/{story['id']}", headers=headers).get_json()
    assert body["parent"]["id"] == epic["id"]
    assert [child["id"] for child in body["children"]] == [task["id"]]
    # And what it *may* be re-parented to is the same rule, offered rather
    # than left to be guessed (§76).
    assert [option["id"] for option in body["parent_options"]] == [epic["id"]]


@pytest.mark.database
def test_deleting_a_story_re_parents_its_tasks_rather_than_taking_them(client, monkeypatch):
    """A story removed by mistake must not take three tasks' history with it."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    epic = _card(client, headers, created["id"], kind="EPIC", title="An epic")
    story = _card(
        client, headers, created["id"], kind="STORY", title="A story", parent_id=epic["id"]
    )
    task = _card(
        client, headers, created["id"], kind="TASK", title="A task", parent_id=story["id"]
    )

    removed = client.delete(
        f"{PREFIX}/api/kanban/cards/{story['id']}", headers=headers
    ).get_json()
    assert removed["reparented"] == 1

    survivor = client.get(
        f"{PREFIX}/api/kanban/cards/{task['id']}", headers=headers
    ).get_json()
    assert survivor["id"] == task["id"]
    # Given to the grandparent, which is where a reader would look for it.
    assert survivor["parent_id"] == epic["id"]


@pytest.mark.database
def test_the_lane_order_is_applied_whole_or_refused(client, monkeypatch):
    """A drag produces one arrangement; a series of swaps is a series of
    states a concurrent reader can observe."""
    headers = _authenticate(monkeypatch)
    created = _board(client, headers)
    lanes = _open(client, headers, created["id"])["lanes"]
    reversed_ids = [lane["id"] for lane in reversed(lanes)]

    applied = client.put(
        f"{BOARDS}/{created['id']}/lanes", json={"lane_ids": reversed_ids}, headers=headers
    )
    assert applied.status_code == 200
    body = _open(client, headers, created["id"])
    assert [lane["id"] for lane in body["lanes"]] == reversed_ids

    # A partial order is refused rather than half-applied.
    refused = client.put(
        f"{BOARDS}/{created['id']}/lanes",
        json={"lane_ids": reversed_ids[:2]},
        headers=headers,
    )
    assert refused.status_code == 400
    assert "exactly once" in refused.get_json()["message"]


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
