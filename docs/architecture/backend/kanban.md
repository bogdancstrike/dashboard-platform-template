# Kanban boards

Kanban boards (§18): a workspace whose columns are somebody's own.

**Why this is a second board.** `/tasks` is a view of the work queue and its
lanes are the declared `TASK_STATUS` vocabulary — the same values every filter,
chart and report reads. A lane invented there would be a status nothing else
has heard of, and a card in it would vanish from every report that counts by
status. This is the other thing people mean by a board: columns they name,
reorder and put limits on. See `models/kanban` for what that costs.

Five decisions worth stating.

**Order is dense integers, rewritten on a drop.** A float midpoint avoids
touching neighbours and drifts into precision nobody can debug; dense integers
mean a drop rewrites the cards after it *in that lane* — a handful of rows,
always readable in psql, and impossible to get into a state where two cards
claim the same place.

**A lane is deleted by moving its cards, never by cascading.** `lane_id` is
nullable so the database *can* orphan a card, and this service never does:
removing a lane hands its cards to another one. Losing somebody's work to a
column they were tidying up is the single worst thing a board can do.

**The hierarchy is one rule in one place.** An epic parents stories; a story
parents tasks and bugs; nothing parents an epic. Written as `PARENT_OF` below,
so a card cannot be made its own grandparent and the error says which pairing
was refused.

**A WIP limit warns, and never refuses.** A limit somebody set last month must
not stop them moving an urgent card today — a board that argues gets worked
around, in a spreadsheet. The count and the limit are both published; saying
"this lane is over its limit" is the board's job and stopping the work is not.

**Sharing is `core/sharing`, not a second model.** A board is shared exactly as
a saved search is: private, named members, or everyone signed in, with
owner-only writes.
