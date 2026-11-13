"""What a board may hold: card kinds, priorities, starter lanes and limits."""

from __future__ import annotations

RESOURCE = "kanban_board"


#: Reading a board needs the same permission as reading a record; making one is
#: a workspace of your own, which is what `dashboards.manage` already means.
VIEW_PERMISSION = "records.view"


MANAGE_PERMISSION = "dashboards.manage"


SHARE_PERMISSION = "searches.share"


#: What a card can be, and what each kind may hold. `()` means it holds
#: nothing — a task has no children, and a bug is not a container.
#:
#: One table rather than a check per call site: "can this be dropped on that"
#: is asked when a card is created, when it is re-parented and when a parent is
#: deleted, and three copies of a rule about hierarchy is how a board ends up
#: with an epic inside a task.
PARENT_OF: dict[str, tuple[str, ...]] = {
    "EPIC": ("STORY",),
    "STORY": ("TASK", "BUG"),
    "TASK": (),
    "BUG": (),
}


KINDS: tuple[str, ...] = tuple(PARENT_OF)


PRIORITIES: tuple[str, ...] = ("LOW", "NORMAL", "HIGH", "CRITICAL")


#: The lanes a new board starts with. A board created empty is a board whose
#: first action is administration rather than work.
STARTER_LANES: tuple[tuple[str, bool], ...] = (
    ("Backlog", False),
    ("Selected", False),
    ("In progress", False),
    ("In review", False),
    ("Done", True),
)


#: A ceiling on lanes, because a board with forty columns is a spreadsheet.
MAX_LANES = 20


#: How many cards a lane returns before the reader has to narrow. A lane is
#: read, not paged through.
CARDS_PER_LANE = 100
