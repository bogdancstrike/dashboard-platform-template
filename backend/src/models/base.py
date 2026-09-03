"""Declarative base and the mixins every table shares.

Three decisions apply platform-wide:

* **UUID primary keys**, generated in PostgreSQL (`gen_random_uuid()`, core
  since PG13). Ids are shareable in URLs (§69) without leaking row counts, and
  a seed can build a whole interconnected graph before a single INSERT.
* **`created_at` / `updated_at` on everything**, server-side. A timestamp set
  by the application clock disagrees with the database's the moment two
  processes disagree about the time.
* **Soft delete where history matters.** `deleted_at` keeps a row queryable for
  audit and referential integrity while removing it from every default list.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, Index, MetaData, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

#: Every constraint and index gets a deterministic name.
#:
#: Two things depend on this. Migrations need to name what they alter, and a
#: constraint PostgreSQL named `users_manager_id_fkey` in one database and
#: `users_manager_id_fkey1` in another is a migration that works on one of them.
#: And `drop_all` has to break foreign-key *cycles* — users → departments →
#: users — by dropping a constraint before the tables, which it can only do if
#: the constraint has a name it knows.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    """All models share this metadata, so `Base.metadata.create_all` builds the
    whole schema in one pass and the seed never has to order its imports."""

    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {dict[str, Any]: JSONB, list[Any]: JSONB}


def uuid_pk() -> Mapped[UUID]:
    return mapped_column(
        PgUUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        server_default=text("gen_random_uuid()"),
    )


def fk(target: str, *, nullable: bool = True, ondelete: str = "SET NULL", index: bool = True):
    return mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey(target, ondelete=ondelete),
        nullable=nullable,
        index=index,
    )


class TimestampMixin:
    created_at: Mapped[Any] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    updated_at: Mapped[Any] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class SoftDeleteMixin:
    deleted_at: Mapped[Any | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class MetadataMixin:
    """Free-form attributes, which every enterprise data model grows within a
    month of shipping. Kept in JSONB so a customer-specific field costs no
    migration; `core/query.py` can still filter it as text (§4)."""

    metadata_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)


class OwnedMixin:
    """Ownership and organizational scope — the columns every list page filters
    by and every permission check will eventually want."""

    owner_id: Mapped[UUID | None] = fk("users.id")
    organization_id: Mapped[UUID | None] = fk("organizations.id")


def short_text(length: int = 255, **kwargs) -> Mapped[str]:
    return mapped_column(String(length), **kwargs)


def gin_index(name: str, column) -> Index:
    """Trigram-free GIN over a JSONB column, for metadata containment queries."""
    return Index(name, column, postgresql_using="gin")
