"""pgvector's `vector` column, without a dependency for one type (§44).

The `pgvector` package would bring this and nothing else the platform needs,
so the type is the twenty lines it takes: a list of floats goes in as
pgvector's text form (`[0.1,0.2]`) and comes back as a list.

**The column is declared without a dimension.** The embedding model sits
behind the gateway's alias and can change — `text-embedding-3-large` answers in
3072 dimensions, the deterministic fake in 256 — and a `vector(3072)` column
would make that swap a migration with every stored row thrown away. The rows
record their own dimension instead, and a search compares only vectors of the
query's size. What that gives up is an HNSW index, which needs a fixed
dimension; at the scale of a team's document collections an exact scan over a
collection's chunks is milliseconds, and exact is also the better answer.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.types import UserDefinedType


class Vector(UserDefinedType):
    """`vector` (any dimension). Python side: `list[float] | None`."""

    cache_ok = True

    def get_col_spec(self, **_: Any) -> str:
        return "vector"

    def bind_processor(self, dialect):
        def process(value):
            return to_text(value)

        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            return from_text(value)

        return process


def to_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return "[" + ",".join(repr(float(x)) for x in value) + "]"


def from_text(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return [float(x) for x in value]
    text = str(value).strip().lstrip("[").rstrip("]")
    return [float(x) for x in text.split(",")] if text else []


# Reflection (the schema-drift check, Alembic's autogenerate) reads column
# types back from PostgreSQL; without this it warns it does not know `vector`.
from sqlalchemy.dialects.postgresql.base import ischema_names  # noqa: E402

ischema_names.setdefault("vector", Vector)
