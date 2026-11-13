"""Kanban boards (§18). — board endpoints."""

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


def test_the_board_endpoints_need_a_bearer_token(client):
    assert client.get(BOARDS).status_code == 401
    assert client.post(BOARDS, json={"name": "x"}).status_code == 401


def test_the_hierarchy_rule_lives_in_one_place():
    """Every kind's children are declared once, and the rule is total.

    Three copies of "can this be dropped on that" is how a board ends up with
    an epic inside a task — and the check happens on create, on re-parent and
    when a parent is deleted.
    """
    from src.services.work.kanban import KINDS, PARENT_OF

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
    from src.services.work.kanban import STARTER_LANES

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
