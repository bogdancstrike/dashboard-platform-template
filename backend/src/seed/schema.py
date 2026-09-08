"""Bringing an existing database up to the model, additively.

`create_all` creates the tables that are absent and leaves alone a table that
exists but has drifted. That is the right behaviour on a first boot and the
wrong one for a database that has been running while the model gained a
column: the table is there, the column is not, and the failure arrives as a
500 on somebody's first write rather than as an error on deploy. Nucleus hit
exactly that — `audit_logs` predated `impersonator_id`, so every audited write
in the running stack failed at the INSERT.

Two decisions worth stating.

**It is derived from the model, never from a list kept here.** The columns,
their types, their indexes and their foreign keys are read out of the same
`MetadataData` the ORM maps, so a column added to a model is a column this
knows about the same day. A hand-written ALTER script is a second description
of the schema, wrong the first time anybody forgets to update it.

**It is additive, and it stops at anything that is not.** Adding a nullable
column to a populated table is safe, as is creating a table that does not
exist yet, and those are the cases that actually happen; dropping a column,
retyping one, or adding a NOT NULL column without a default loses data or
fails, and belongs in a migration somebody has read. Those are *reported*,
with the reason, rather than attempted — which is why this is a drift report
that can also fix the easy half, not a migration tool.

A missing table used to be reported with the advice "run the seed", which is
advice a populated database cannot take: seeding refuses to touch one. So a
model that grew a table had no path forward at all short of a destructive
reseed. `CREATE TABLE` touches no existing row, so it belongs on the additive
side of that line.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import inspect, text
from sqlalchemy.schema import AddConstraint, CreateIndex, Table
from sqlalchemy.sql.ddl import CreateColumn


@dataclass(frozen=True, slots=True)
class Drift:
    """One thing the model declares that the database does not have."""

    table: str
    #: Empty when the whole table is missing.
    column: str
    #: Whether `reconcile` may add it without risking data.
    addable: bool
    reason: str

    def __str__(self) -> str:
        what = f"{self.table}.{self.column}" if self.column else f"table {self.table}"
        return f"{what} — {self.reason}"


def drift(engine, metadata) -> list[Drift]:
    """Every table and column the model declares and the database lacks."""
    inspector = inspect(engine)
    present = set(inspector.get_table_names())

    found: list[Drift] = []
    for name, table in sorted(metadata.tables.items()):
        if name not in present:
            # A whole table, which `reconcile` creates: `CREATE TABLE` is as
            # additive as `ADD COLUMN` and touches no existing row. This used
            # to say "run the seed", which is advice a populated database
            # cannot take — seeding refuses to touch one, rightly — so a model
            # that grew a table had no non-destructive path at all.
            found.append(Drift(name, "", True, "the table does not exist"))
            continue
        live = {column["name"] for column in inspector.get_columns(name)}
        for column in table.columns:
            if column.name in live:
                continue
            found.append(Drift(name, column.name, *_addability(column)))
    return found


def _addability(column) -> tuple[bool, str]:
    """Whether a missing column can simply be added, and why not when it cannot."""
    if column.nullable or column.server_default is not None:
        return True, "declared by the model, missing from the database"
    return (
        False,
        "declared NOT NULL with no default; existing rows would have no value, "
        "so this needs a migration that decides what they get",
    )


def reconcile(engine, metadata) -> list[Drift]:
    """Add the columns that can be added. Returns what was added.

    Each column arrives with the index and the foreign key the model declares
    on it, so a reconciled database is indexed and constrained the same way a
    freshly created one is — a column added without its index is a query plan
    that quietly changes shape under load.
    """
    added: list[Drift] = []
    with engine.begin() as connection:
        for item in drift(engine, metadata):
            if not item.addable:
                continue
            if not item.column:
                # A whole table. Created with its indexes and constraints by
                # the metadata itself, so it is indistinguishable from one a
                # first boot would have made — and `checkfirst` keeps this
                # idempotent when two of them arrive together.
                metadata.tables[item.table].create(bind=connection, checkfirst=True)
                added.append(item)
                continue
            table = metadata.tables[item.table]
            column = table.columns[item.column]
            connection.execute(
                _ddl(f"ALTER TABLE {_quoted(table)} ADD COLUMN ", CreateColumn(column), engine)
            )
            for statement in _attachments(table, column, engine):
                connection.execute(statement)
            added.append(item)
    return added


def _attachments(table: Table, column, engine):
    """The index and foreign key that belong to one freshly added column."""
    for index in table.indexes:
        if [c.name for c in index.columns] == [column.name]:
            yield CreateIndex(index)
    for constraint in table.foreign_key_constraints:
        if [c.name for c in constraint.columns] == [column.name]:
            yield AddConstraint(constraint)


def _ddl(prefix: str, element, engine):
    """`ALTER TABLE … ADD COLUMN <the model's own column definition>`.

    Compiled by the dialect rather than formatted here, so the type, the
    default and the collation are whatever the model says they are.
    """
    return text(prefix + str(element.compile(dialect=engine.dialect)))


def _quoted(table: Table) -> str:
    return f'"{table.name}"'
