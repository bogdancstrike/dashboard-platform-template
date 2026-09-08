"""Bringing a running database up to the model, additively (§9, §57).

`create_all` is silent about a table that already exists but has since grown a
column in the model, and the failure that follows arrives as a 500 on the next
INSERT rather than as an error on deploy — which is exactly what happened to
`audit_logs.impersonator_id`. What is asserted here is the contract that
closes it: the drift is *found* from the model rather than from a list kept by
hand, what can be added safely is added with its index and its foreign key,
and what cannot is reported with the reason instead of attempted.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Column, ForeignKey, Integer, MetaData, String, Table, inspect, text
from sqlalchemy.dialects.postgresql import UUID as PgUUID

from src.seed import schema


@pytest.fixture()
def probe(engine):
    """A scratch table one column behind the model that describes it.

    A real table on the real database, because the whole point of this module
    is what PostgreSQL does with an ALTER; a fake inspector would assert the
    code agrees with itself.
    """
    with engine.begin() as connection:
        connection.execute(text('DROP TABLE IF EXISTS "drift_probe"'))
        connection.execute(text('CREATE TABLE "drift_probe" (id INTEGER PRIMARY KEY)'))
    yield
    with engine.begin() as connection:
        connection.execute(text('DROP TABLE IF EXISTS "drift_probe"'))


def _model() -> MetaData:
    """What the model declares: two columns the scratch table does not have."""
    metadata = MetaData()
    # The referenced table, declared only so the foreign key can be rendered.
    # It matches what the database already has, so it contributes no drift of
    # its own — which the assertions below rely on.
    Table("users", metadata, Column("id", PgUUID(as_uuid=True), primary_key=True))
    Table(
        "drift_probe", metadata,
        Column("id", Integer, primary_key=True),
        Column("actor_id", PgUUID(as_uuid=True), ForeignKey("users.id"), index=True),
        Column("required", String(16), nullable=False),
    )
    return metadata


@pytest.mark.database
def test_it_finds_what_the_model_has_and_the_database_does_not(engine, probe):
    found = {item.column: item for item in schema.drift(engine, _model())}

    assert set(found) == {"actor_id", "required"}
    assert found["actor_id"].addable
    # A NOT NULL column with no default cannot be added to a populated table
    # without deciding what the existing rows get — which is a migration
    # somebody has to read, not an ALTER run on boot.
    assert not found["required"].addable
    assert "NOT NULL" in found["required"].reason


@pytest.mark.database
def test_it_adds_the_column_with_its_index_and_its_foreign_key(engine, probe):
    added = schema.reconcile(engine, _model())

    assert [item.column for item in added] == ["actor_id"]
    inspector = inspect(engine)
    assert "actor_id" in {column["name"] for column in inspector.get_columns("drift_probe")}
    # A column added without the index the model declares is a query plan that
    # quietly changes shape under load.
    assert any(
        index["column_names"] == ["actor_id"] for index in inspector.get_indexes("drift_probe")
    )
    assert any(
        key["constrained_columns"] == ["actor_id"] and key["referred_table"] == "users"
        for key in inspector.get_foreign_keys("drift_probe")
    )


@pytest.mark.database
def test_what_it_cannot_add_is_still_reported_afterwards(engine, probe):
    schema.reconcile(engine, _model())

    remaining = schema.drift(engine, _model())
    assert [item.column for item in remaining] == ["required"]


@pytest.mark.database
def test_a_table_the_model_grew_is_created_rather_than_reported(engine):
    """A missing *table* is additive too, and it used to have no path at all.

    The drift report said "run the seed", which is advice a populated database
    cannot take — seeding refuses to touch one, rightly. So a model that grew
    a table (announcements did) left a running installation with a choice
    between a destructive reseed and a hand-written DDL script. `CREATE TABLE`
    touches no existing row, so it belongs on this side of the line.
    """
    metadata = MetaData()
    Table("users", metadata, Column("id", PgUUID(as_uuid=True), primary_key=True))
    Table(
        "drift_newcomer", metadata,
        Column("id", Integer, primary_key=True),
        Column("actor_id", PgUUID(as_uuid=True), ForeignKey("users.id"), index=True),
        Column("label", String(32), nullable=False),
    )

    with engine.begin() as connection:
        connection.execute(text('DROP TABLE IF EXISTS "drift_newcomer"'))
    try:
        reported = [item for item in schema.drift(engine, metadata) if item.table == "drift_newcomer"]
        assert [item.column for item in reported] == [""]
        assert reported[0].addable

        added = schema.reconcile(engine, metadata)
        assert [(item.table, item.column) for item in added] == [("drift_newcomer", "")]

        # Created the way a first boot would have: NOT NULL columns and all,
        # because there are no existing rows to decide anything about.
        inspector = inspect(engine)
        columns = {column["name"] for column in inspector.get_columns("drift_newcomer")}
        assert columns == {"id", "actor_id", "label"}
        assert inspector.get_indexes("drift_newcomer"), "the declared index was not created"

        # Idempotent: a second run finds nothing to do.
        assert schema.reconcile(engine, metadata) == []
        assert not [item for item in schema.drift(engine, metadata) if item.table == "drift_newcomer"]
    finally:
        with engine.begin() as connection:
            connection.execute(text('DROP TABLE IF EXISTS "drift_newcomer"'))


@pytest.mark.database
def test_a_database_that_matches_the_model_has_no_drift(engine):
    """The real schema, which the seed created, against the real model."""
    import src.models as models

    assert [item for item in schema.drift(engine, models.Base.metadata) if item.column] == []
