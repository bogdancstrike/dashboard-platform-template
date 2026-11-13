# Organizations, departments and teams (§42): the shape of the company

Organizations, departments and teams (§42): the shape of the company.

One tenant, its departments nested inside each other, and the teams that sit in
those. Three tables and one screen, because they are one question: *where does
a person sit, and who is above them?*

Five decisions worth stating.

**Headcount is computed, never read.** `departments.headcount` is a stored
column that was drawn at random before the users existed — so Support said 116
people with nobody at all assigned to it. Two numbers for one fact, and the
stored one lied. This service counts `users.department_id`, so the API is right
even if the column drifts again; `--sync-org` and `--check` keep the column
honest for anything reading it directly.

**A department's headcount is its own, not its subtree's.** Rolling children up
into a parent makes the numbers on a tree sum to more than the organisation
employs, which is the same defect the other way round. The subtree total is
offered as its own figure, named as such.

**The tree is built once, in Python, from one query.** A recursive CTE per node
or a `selectinload` per level is how a four-level structure becomes forty
queries; the rows come back flat and are threaded here.

**A department cannot become its own ancestor.** Re-parenting is the one edit
that can corrupt the structure — a cycle makes the tree infinite and every page
that walks it hang — so the move is refused with the path named.

**Deleting is refused while anything is inside.** Unlike a group, which is a
set, a department is a *place*: people and teams point at it, and
`ondelete="CASCADE"` on those columns means a silent delete would take the
teams with it and orphan the people. So it says what is in the way and leaves
the operator to move them.
