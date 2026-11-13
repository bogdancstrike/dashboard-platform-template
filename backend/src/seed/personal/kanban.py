"""Seed data for personal: _kanban."""

from __future__ import annotations

from datetime import timedelta

from src.seed import catalog
from src.seed.personal.saved_searches import _audience
from src.seed.support import reference
from src.seed.world import World


def _kanban(world: World) -> None:
    """Boards with a real hierarchy on them (§18).

    Three properties this builds deliberately, because each is a thing the
    board cannot demonstrate without it.

    **Every lane holds cards, and one lane is over its limit.** A board where
    the columns are empty demonstrates columns; the point of a WIP limit is the
    moment it is exceeded, and a seed where it never is has shipped an
    untested warning.

    **The hierarchy is complete**: epics hold stories, stories hold tasks and
    bugs, and the references are the board's own key. A story with no parent
    epic is the state the *service* refuses, so the seed must not create it.

    **The lane a card is in agrees with its timestamps.** A card in "Done"
    has a `completed_at`; one in the backlog has no `started_at`. The board
    computes nothing from those, but every report does — and a dataset where
    they disagree is a dataset that makes the reports look broken.
    """
    from src.models.kanban import Board, BoardCard, BoardLane

    rng = world.rng.derive("kanban")
    audience = _audience(world)
    if not audience:
        return

    for index in range(world.scale.kanban_boards):
        name, key, epics = catalog.KANBAN_BOARDS[index % len(catalog.KANBAN_BOARDS)]
        if index >= len(catalog.KANBAN_BOARDS):
            name, key = f"{name} ({index // len(catalog.KANBAN_BOARDS) + 1})", f"{key}{index}"

        # Owned by a persona in turn, so every one of them has a board to
        # open — §67 cannot be demonstrated by a dataset where the boards
        # belong to strangers.
        owner = list(world.personas.values())[index % len(world.personas)] if world.personas else rng.pick(audience)
        board = Board(
            id=rng.uuid(),
            key=key,
            name=name,
            description=rng.maybe(
                "Reviewed on Tuesdays. Anything in review for more than two "
                "days is discussed rather than left.",
                0.6,
            ),
            owner_id=owner.id,
            organization_id=owner.organization_id,
            scope=rng.weighted((("PRIVATE", 0.3), ("SHARED", 0.3), ("PUBLIC", 0.4))),
            is_archived=False,
            created_at=rng.ago(days_min=30, days_max=300),
        )
        world.kanban_boards.append(board)

        lanes = []
        for position, (lane_name, is_done) in enumerate(
            (("Backlog", False), ("Selected", False), ("In progress", False),
             ("In review", False), ("Done", True))
        ):
            lanes.append(
                BoardLane(
                    id=rng.uuid(),
                    board_id=board.id,
                    name=lane_name,
                    position=position,
                    # A limit on the two lanes where one means something. "In
                    # progress" gets a tight one on purpose: the board has to
                    # be able to show a lane over its limit.
                    wip_limit=3 if lane_name == "In progress" else (6 if lane_name == "In review" else None),
                    is_done=is_done,
                    created_at=board.created_at,
                )
            )
        world.kanban_lanes.extend(lanes)

        members = world.users_by_org.get(board.organization_id, []) or audience
        counter = 0
        positions: dict = {lane.id: 0 for lane in lanes}

        def _place(kind: str, title: str, parent, lane) -> BoardCard:
            nonlocal counter
            counter += 1
            created = rng.between(board.created_at, world.anchor)
            done = lane.is_done
            started = None if lane.position == 0 else rng.between(created, world.anchor)
            card = BoardCard(
                id=rng.uuid(),
                board_id=board.id,
                lane_id=lane.id,
                reference=reference(board.key, counter),
                kind=kind,
                title=title,
                description=rng.maybe(
                    "Acceptance criteria are on the linked document. Raise a "
                    "blocker rather than working around it.",
                    0.55,
                ),
                parent_id=parent.id if parent else None,
                position=positions[lane.id],
                priority=rng.weighted(
                    (("LOW", 0.2), ("NORMAL", 0.45), ("HIGH", 0.25), ("CRITICAL", 0.1))
                ),
                story_points=(
                    rng.pick((1, 2, 3, 5, 8, 13)) if kind in ("STORY", "EPIC") else None
                ),
                assignee_id=rng.pick(members).id if members and rng.chance(0.8) else None,
                reporter_id=owner.id,
                labels=list(rng.sample(catalog.KANBAN_LABELS, rng.integer(0, 2))),
                due_date=rng.maybe(
                    (created + timedelta(days=rng.integer(5, 60))).date(), 0.5
                ),
                started_at=started,
                completed_at=rng.between(started or created, world.anchor) if done else None,
                checklist=(
                    [
                        {"text": text, "done": rng.chance(0.5)}
                        for text in rng.sample(
                            ("Reviewed", "Tested", "Documented", "Deployed"), rng.integer(2, 3)
                        )
                    ]
                    if rng.chance(0.4)
                    else None
                ),
                created_at=created,
            )
            positions[lane.id] += 1
            world.kanban_cards.append(card)
            return card

        # Epics live in the backlog: they are the plan, not the work.
        for epic_title, stories in epics:
            epic = _place("EPIC", epic_title, None, lanes[0])
            for story_title in stories:
                # Stories spread across the lanes, weighted towards the left —
                # a board where everything is done is a board nobody is using.
                lane = rng.weighted(
                    tuple(zip(lanes, (0.32, 0.18, 0.2, 0.12, 0.18), strict=True))
                )
                story = _place("STORY", story_title, epic, lane)
                for kind, piece in rng.sample(
                    catalog.KANBAN_PIECES, rng.integer(1, 3)
                ):
                    _place(kind, piece, story, rng.weighted(
                        tuple(zip(lanes, (0.35, 0.15, 0.2, 0.1, 0.2), strict=True))
                    ))

        # Every lane holds something, and one is over its limit. A board whose
        # columns are empty demonstrates columns; the point of a WIP limit is
        # the moment it is exceeded, and a seed where it never is has shipped
        # an untested warning.
        for lane in lanes:
            held = [card for card in world.kanban_cards
                    if card.board_id == board.id and card.lane_id == lane.id]
            wanted = (lane.wip_limit + 1) if lane.name == "In progress" else 1
            stories = [card for card in world.kanban_cards
                       if card.board_id == board.id and card.kind == "STORY"]
            while len(held) < wanted and stories:
                kind, piece = rng.pick(catalog.KANBAN_PIECES)
                held.append(_place(kind, piece, rng.pick(stories), lane))
