"""Shared helpers and fixtures for the query tests."""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import (
    ARRAY,
    Boolean,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

from src.core.query import (
    Field,
    FieldSet,
    apply_filters,
)

ONE = UUID("11111111-1111-1111-1111-111111111111")


TWO = UUID("22222222-2222-2222-2222-222222222222")


THREE = UUID("33333333-3333-3333-3333-333333333333")


#: The rows every assertion below is written against.
#:
#: Row 1 and row 2 differ only in the *case* of their name, which is what makes
#: the case-insensitivity claim checkable. Row 3 is empty in every column —
#: the row that a naive `!=` drops. Row 4 carries an empty *string* and an
#: empty array, which is a different absence from row 3's NULL and must be
#: treated as the same one.
ROWS = (
    (1, "Ana Pop", "OPEN", 5, True, "2026-01-10T09:00:00+00:00", ONE, {"a": 1}, ["x", "y"]),
    (2, "ana pop", "CLOSED", 50, False, "2026-02-20T09:00:00+00:00", TWO, {"b": 2}, ["y"]),
    (3, None, None, None, None, None, None, None, None),
    (4, "", "BLOCKED", 0, True, "2026-03-05T09:00:00+00:00", THREE, {}, []),
)


@pytest.fixture()
def probe(engine):
    """A table of one column per field kind, dropped however the test ends."""
    metadata = MetaData()
    table = Table(
        "query_probe",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("name", String(64)),
        Column("status", String(16)),
        Column("score", Integer),
        Column("flag", Boolean),
        Column("at", DateTime(timezone=True)),
        Column("ref", PgUUID(as_uuid=True)),
        Column("meta", JSONB),
        Column("tags", ARRAY(String(32))),
    )
    with engine.begin() as connection:
        connection.execute(text('DROP TABLE IF EXISTS "query_probe"'))
        metadata.create_all(connection)
        connection.execute(
            table.insert(),
            [
                dict(zip(
                    ("id", "name", "status", "score", "flag", "at", "ref", "meta", "tags"),
                    row,
                    strict=True,
                ))
                for row in ROWS
            ],
        )
    yield table
    with engine.begin() as connection:
        connection.execute(text('DROP TABLE IF EXISTS "query_probe"'))


@pytest.fixture()
def spec(probe):
    return FieldSet(
        Field("id", probe.c.id, kind="number"),
        Field("name", probe.c.name, searchable=True),
        Field("status", probe.c.status, kind="enum", facet=True, choices=("OPEN", "CLOSED")),
        Field("score", probe.c.score, kind="number"),
        Field("flag", probe.c.flag, kind="bool"),
        Field("at", probe.c.at, kind="datetime"),
        Field("ref", probe.c.ref, kind="uuid"),
        Field("meta", probe.c.meta, kind="json"),
        Field("tags", probe.c.tags, kind="array"),
    )


@pytest.fixture()
def matching(engine, probe):
    """The ids a predicate selects, in order — the answer every test reads."""

    def run(predicate) -> list[int]:
        statement = select(probe.c.id).order_by(probe.c.id)
        if predicate is not None:
            statement = statement.where(predicate)
        with engine.connect() as connection:
            return [row[0] for row in connection.execute(statement).all()]

    return run


@pytest.fixture()
def filtered(engine, probe, spec):
    """The ids `apply_filters` selects for a set of query parameters."""

    def run(args: dict) -> list[int]:
        statement = apply_filters(select(probe.c.id), args, spec)
        with engine.connect() as connection:
            return [row[0] for row in connection.execute(statement.order_by(probe.c.id)).all()]

    return run


#: A value of the right shape for each kind, so an operator can be *run*.
SAMPLE = {
    "text": "ana pop",
    "enum": "OPEN",
    "number": "5",
    "bool": "true",
    "datetime": "2026-01-10T09:00:00+00:00",
    "uuid": str(ONE),
    "json": "1",
    "array": "y",
}
