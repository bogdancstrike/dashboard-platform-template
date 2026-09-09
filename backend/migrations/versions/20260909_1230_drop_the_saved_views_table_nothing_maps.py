"""drop the saved_views table nothing maps

A saved *view* is a saved *search* (§46). The model layer carried both for a
while — `saved_searches` for the question and `saved_views` for the
presentation — and the second was never read: one store for "how I look at
this list" was the decision, the `SavedView` class went, and the comment where
it used to be says a migration would take the table.

This is that migration. It removes rows that nothing maps, nothing serves and
no endpoint returns; the thousand rows the platform actually uses are in
`saved_searches` and are untouched. The downgrade puts the table back empty,
which is the honest inverse — the rows it held were unreadable before this ran
and would be unreadable after.

**It is conditional, and that is the point of it.** A database built from the
first revision never had the table, because that revision is generated from
the models and the model was already gone. This revision exists for the
databases that predate the decision, so it asks whether the table is there
rather than assuming — the same shape as `DROP TABLE IF EXISTS`, written out
because Alembic's `drop_table` has no such flag. On a fresh database it is a
no-op, which is exactly what "this table should not exist" means there.

**And it does not come back.** The downgrade is deliberately empty: the
previous state is "a table nothing maps exists, holding rows nothing can
read", which is not a state worth restoring — and a downgrade that recreated
it would leave the revision *before* this one unable to run, because the
recreated table's foreign keys point at tables that revision drops. So the
revision declares itself irreversible with the reason, which
`tests/test_migrations.py` accepts in place of a body and nothing else does.

Revision: 1845cad360f1
Parent:   d3dc6cd5369a
Created:  2026-09-09 12:30:28.197126+00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '1845cad360f1'
down_revision: str | None = 'd3dc6cd5369a'
branch_labels: str | None = None
depends_on: str | None = None


TABLE = "saved_views"

#: Why this one cannot be undone, in place of a `downgrade` body.
#:
#: Read by `tests/test_migrations.py`, which otherwise requires every revision
#: to be reversible — a migration nobody dares apply is one whose previous
#: version is unreachable, and that rule is worth keeping for every revision
#: that *changes* something rather than removing what was already dead.
IRREVERSIBLE = (
    "The table held rows nothing mapped, served or returned. Restoring an "
    "empty copy of it would put back a shape the models do not describe — and "
    "its foreign keys would then block the revision below this one from "
    "dropping the tables they point at."
)


def _present() -> bool:
    """Whether this database is one that predates the decision."""
    return sa.inspect(op.get_bind()).has_table(TABLE)


def upgrade() -> None:
    if not _present():
        return
    # The indexes go with the table, so only the table is named: DROP TABLE
    # takes its own indexes, and listing them separately would be ten
    # statements that can each fail on a database somebody has already
    # tidied by hand.
    op.drop_table(TABLE)


def downgrade() -> None:
    """Nothing: see `IRREVERSIBLE`."""
