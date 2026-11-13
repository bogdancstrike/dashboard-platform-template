"""The seed, checked without a database. — saved searches."""

from __future__ import annotations

import pytest

from src.seed import catalog, runner
from src.seed.world import FULL
from tests.seed_support import (  # noqa: F401
    SEED,
    scratch_database,
    world,
)


def test_saved_searches_are_private_by_default(world):
    """§5: nothing is shared by accident, so most searches have no audience.

    Measured over the ones the generator *invents*. The six named list views
    are deliberately public — a views menu only its owner can see demonstrates
    nothing (§46) — and they are asserted as such here rather than left to
    swamp the property this test is about, which is that a saved search nobody
    decided to share is private.
    """
    deliberate = {name for name, *_rest in catalog.LIST_VIEWS}
    scopes = [
        search.scope for search in world.saved_searches if search.name not in deliberate
    ]
    assert set(scopes) <= {"PRIVATE", "SHARED", "PUBLIC"}
    assert scopes.count("PRIVATE") > scopes.count("PUBLIC")

    shipped = [search for search in world.saved_searches if search.name in deliberate]
    assert len(shipped) == len(catalog.LIST_VIEWS)
    # Public, and free of a condition tree: a tree cannot be drawn as facet
    # selects, so one here would be a view no list could show (§46).
    assert all(search.scope == "PUBLIC" for search in shipped)
    assert all(search.condition_tree is None for search in shipped)
    assert all(search.filters for search in shipped)


def test_only_shared_searches_have_members(world):
    """A share row on a private search is dead data the visibility query would
    then have to remember to ignore."""
    by_id = {str(search.id): search for search in world.saved_searches}
    for share in world.resource_shares:
        assert share.resource_type == "saved_search"
        owner_search = by_id[share.resource_id]
        assert owner_search.scope == "SHARED"


def test_a_share_never_grants_edit(world):
    """Editing and deleting belong to the owner alone (§5)."""
    assert all(share.permission == "VIEW" for share in world.resource_shares)


def test_nobody_is_a_member_of_their_own_search(world):
    by_id = {str(search.id): search for search in world.saved_searches}
    for share in world.resource_shares:
        assert share.user_id != by_id[share.resource_id].owner_id


def test_shares_are_unique_per_person_and_resource(world):
    keys = [(s.resource_type, s.resource_id, s.user_id) for s in world.resource_shares]
    assert len(keys) == len(set(keys))


def test_credentials_never_store_plaintext(world):
    for credential in world.api_credentials:
        assert credential.secret_hash.startswith("sha256$")
        assert len(credential.prefix) <= 12


def test_full_scale_meets_the_documented_volumes():
    """The numbers in docs/TODO.md, asserted rather than assumed."""
    world = runner.generate(scale=FULL, seed=SEED)
    counts = world.counts()
    for table, minimum in (
        ("organizations", 20), ("users", 150), ("projects", 50), ("tasks", 500),
        ("audit_logs", 1000), ("email_messages", 200), ("files", 100),
        ("background_jobs", 100), ("customers", 300), ("orders", 800),
    ):
        assert counts[table] >= minimum, f"{table}: {counts[table]} < {minimum}"
    assert world.total() > 10_000


@pytest.mark.database
def test_seed_writes_and_verifies(scratch_database, tmp_path):
    """A seeded installation is consistent — as `python -m src.seed` leaves it.

    `run` writes rows; two passes after it write the *bytes* those rows point
    at, and `verify` checks both. So the test performs both, as the command
    does — a seeded export whose file was never written is a download button
    that 404s, which is exactly the class of defect `verify` is here to catch.

    The stores are local and under `tmp_path`, so a scratch database's
    artefacts never reach the bucket a real installation shares.
    """
    from src.core.db import session_scope
    from src.core.storage import LocalStorage
    from src.seed import blobs
    from src.seed import exports as export_files

    store = LocalStorage(str(tmp_path / "objects"), secret="test", prefix="/files")

    runner.drop_schema(scratch_database)
    runner.bootstrap_schema(scratch_database)
    with session_scope() as session:
        runner.run(session, scale="small", seed=SEED)
        blobs.materialise(session, store)
        export_files.materialise(session, store)
        assert runner.verify(session) == [], runner.verify(session)


def test_every_task_status_has_at_least_one_task(world):
    """`/tasks` is a *board*, and an empty lane is a column of nothing.

    The statuses are weighted, so at a small scale one can come out empty —
    and it is a ratchet: the end-to-end suite moves a card between lanes and
    puts it back only when it passes, so a failing run drains the lane it took
    from. `NEW` reached zero that way in the development database, after which
    every later run failed for want of a card to drag.
    """
    from collections import Counter

    from src.core import vocabulary

    counted = Counter(task.status for task in world.tasks)
    missing = [status for status in vocabulary.TASK_STATUS if counted.get(status, 0) == 0]
    assert not missing, f"no task is {missing}"


def test_a_task_that_has_not_started_has_no_start(world):
    """Coverage must not be bought with a contradiction: a task that reads
    `NEW` and was started last Tuesday is worse than a missing lane."""
    for task in world.tasks:
        if task.status == "NEW":
            assert task.started_at is None, task.reference
        if task.status != "DONE":
            assert task.completed_at is None, task.reference


def test_every_kanban_lane_holds_cards(world):
    """A board whose columns are empty demonstrates columns and nothing else."""
    lanes = {lane.id: lane for lane in world.kanban_lanes}
    held: dict = {}
    for card in world.kanban_cards:
        held[card.lane_id] = held.get(card.lane_id, 0) + 1

    assert world.kanban_boards, "the seed builds no boards"
    for lane_id, lane in lanes.items():
        assert held.get(lane_id, 0) > 0, f"{lane.name} is empty"


def test_one_lane_is_over_its_work_in_progress_limit(world):
    """The point of a limit is the moment it is exceeded.

    A dataset where no lane ever passes its limit ships a warning nobody has
    seen — and the warning is the whole reason the limit is a number rather
    than a comment.
    """
    counted: dict = {}
    for card in world.kanban_cards:
        counted[card.lane_id] = counted.get(card.lane_id, 0) + 1

    over = [
        lane
        for lane in world.kanban_lanes
        if lane.wip_limit is not None and counted.get(lane.id, 0) > lane.wip_limit
    ]
    assert over, "no lane is over its limit, so the warning is undemonstrable"


def test_the_kanban_hierarchy_obeys_its_own_rule(world):
    """Epics hold stories; stories hold tasks and bugs; nothing holds an epic.

    The *service* refuses anything else, so a seed that produced it would be a
    dataset the product could not have created — and the first person to move
    a card would be told their board is invalid.
    """
    from src.services.work.kanban import PARENT_OF

    by_id = {card.id: card for card in world.kanban_cards}
    for card in world.kanban_cards:
        if card.parent_id is None:
            assert card.kind in ("EPIC", "TASK", "BUG"), card.reference
            continue
        parent = by_id[card.parent_id]
        assert card.kind in PARENT_OF[parent.kind], f"{parent.kind} holding {card.kind}"
        assert parent.board_id == card.board_id, "a card's parent is on another board"


def test_a_kanban_card_agrees_with_the_lane_it_is_in(world):
    """The board computes nothing from these timestamps and every report does.

    A card in "Done" with no `completed_at`, or one in the backlog that was
    started last Tuesday, is a dataset that makes the reports look broken.
    """
    lanes = {lane.id: lane for lane in world.kanban_lanes}
    for card in world.kanban_cards:
        lane = lanes[card.lane_id]
        if lane.is_done:
            assert card.completed_at is not None, card.reference
        else:
            assert card.completed_at is None, card.reference
        if lane.position == 0:
            assert card.started_at is None, card.reference


def test_kanban_references_are_unique_and_carry_their_board_key(world):
    """`PLAT-00042` is quotable without naming the board, which only works if
    the key is the board's and the number is unique."""
    keys = {board.id: board.key for board in world.kanban_boards}
    references = [card.reference for card in world.kanban_cards]
    assert len(references) == len(set(references))
    for card in world.kanban_cards:
        assert card.reference.startswith(f"{keys[card.board_id]}-"), card.reference


def test_every_persona_owns_a_board(world):
    """§67 cannot be demonstrated by a dataset whose boards belong to strangers."""
    owners = {board.owner_id for board in world.kanban_boards}
    personas = [user.id for user in world.personas.values()]
    assert owners & set(personas), "no persona owns a board"


def test_no_persona_signs_in_to_a_collapsed_sidebar(world):
    """A rail of unlabelled icons on first sign-in reads as broken navigation.

    The seed gave a quarter of the personas `sidebar_collapsed: True`, which is
    a preference nobody set for themselves, on the one control that decides
    whether the product looks like it has any features. The same class of bug
    as the five-per-cent rollout on `/dashboards` (§27, §40) and fixed the same
    way: the demo never ships a state that hides shipped navigation.
    """
    assert world.users
    for user in world.users:
        appearance = (user.preferences or {}).get("appearance", {})
        assert appearance.get("sidebar_collapsed") is False, user.email


def test_the_preferences_repair_fills_keys_in_and_expands_the_sidebar():
    """`sync_preferences` is additive, except for the collapsed sidebar (§40).

    A value somebody chose survives it — that is what makes it safe to run on
    every deploy — and a key the declaration has gained appears with its
    default rather than being absent until the next write.
    """
    from src.services.people.account import PREFERENCE_DEFAULTS

    class _User:
        def __init__(self, preferences):
            self.preferences = preferences

    stale = _User({
        "appearance": {"theme": "dark", "sidebar_collapsed": True},
        "formats": {"date": "DD/MM/YYYY"},
    })
    current = _User({section: dict(keys) for section, keys in PREFERENCE_DEFAULTS.items()})

    class _Session:
        def scalars(self, _statement):
            return _Rows([stale, current])

    class _Rows(list):
        def all(self):
            return list(self)

    result = runner.sync_preferences(_Session())

    assert result == {"filled": 1, "expanded": 1}
    # The choices survive; the missing keys arrive; the sidebar is expanded.
    assert stale.preferences["appearance"]["theme"] == "dark"
    assert stale.preferences["appearance"]["sidebar_collapsed"] is False
    assert stale.preferences["formats"]["date"] == "DD/MM/YYYY"
    assert stale.preferences["formats"]["time"] == PREFERENCE_DEFAULTS["formats"]["time"]
    assert set(stale.preferences) == set(PREFERENCE_DEFAULTS)
    # And an account already up to date is not rewritten.
    assert current.preferences == {
        section: dict(keys) for section, keys in PREFERENCE_DEFAULTS.items()
    }


def test_every_dataset_is_demonstrable_in_the_activity_feed(world):
    """A feed exists to be filtered, and the filter has to find something.

    The history was drawn from one flat pool of every record, picked from
    uniformly — so a dataset was the subject of an event in proportion to how
    many rows it had. Eight hundred orders against fifty projects meant a
    project was the subject of one event in forty, and once the feed is scoped
    to an organization there were demo accounts whose project filter matched
    nothing at all. The page then reads "nothing has happened", which is a
    different and wrong answer (§34).

    The dataset is chosen before the record now, so each gets roughly the same
    share of the history whatever its volume.
    """
    from collections import Counter

    seen = Counter(entry.resource_type for entry in world.activity_entries)
    expected = {"project", "task", "ticket", "order", "customer", "user"}
    assert expected <= set(seen), f"no activity against {sorted(expected - set(seen))}"

    # And not merely present: the rarest dataset is within an order of
    # magnitude of the commonest, or the filter is technically demonstrable and
    # practically empty once an organization is chosen.
    assert min(seen[kind] for kind in expected) * 10 > max(seen.values())


def test_each_persona_can_filter_the_feed_by_any_dataset(world):
    """The scoped version of the claim above, which is the one that bit.

    The feed a demo account sees is its own organization's. A dataset that is
    well represented across twenty organizations and absent from the one the
    administrator belongs to is a dataset whose filter is broken for the person
    most likely to try it.
    """
    from collections import Counter

    assert world.personas, "the seed builds no personas"
    for persona in world.personas.values():
        seen = Counter(
            entry.resource_type
            for entry in world.activity_entries
            if entry.organization_id == persona.organization_id
        )
        for kind in ("project", "task", "ticket", "order", "customer", "user"):
            assert seen[kind] > 0, f"{persona.email} sees no {kind} activity"
