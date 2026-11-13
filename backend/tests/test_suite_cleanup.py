"""The suite's own teardown: it undoes what the test did, and nothing else.

The suite shares its database with the running stack, the end-to-end suite and
the load test. A teardown that swept "every row newer than the test" deleted
their data too, and restored nothing a test had changed. These pin the
replacement (`tests/undo_log.py`) to exactly the test's own statements.
"""

from __future__ import annotations

import uuid

import pytest

from tests.undo_log import LOG, _same_database, _select_for, restore, sweep

pytestmark = pytest.mark.database


def _tag(slug: str):
    from src.models import Tag

    return Tag(name=slug, slug=slug, category="GENERAL")


def _value(engine, sql: str, **params):
    from sqlalchemy import text

    with engine.begin() as connection:
        return connection.execute(text(sql), params).scalar()


def test_a_row_the_test_inserts_is_recorded_and_swept(engine):
    from src.core.db import session_scope

    slug = f"cleanup-own-{uuid.uuid4().hex[:8]}"
    with session_scope() as session:
        tag = _tag(slug)
        session.add(tag)
        session.flush()
        entry = ("tags", (str(tag.id),))

    assert entry in LOG.current.inserted
    assert sweep(engine, {entry: LOG.current.inserted[entry]}) == []
    assert _value(engine, "select count(*) from tags where slug = :s", s=slug) == 0


def test_a_row_another_connection_inserts_is_never_recorded(engine):
    """What another process writes meanwhile — e2e data, a load run — is not ours."""
    slug = f"cleanup-foreign-{uuid.uuid4().hex[:8]}"
    raw = engine.raw_connection()  # a DBAPI connection: below SQLAlchemy's events
    try:
        with raw.cursor() as cursor:
            cursor.execute(
                "insert into tags (id, name, slug, color, category, usage_count, is_system, created_at, updated_at)"
                " values (gen_random_uuid(), %s, %s, '#000000', 'GENERAL', 0, false, now(), now())",
                (slug, slug),
            )
        raw.commit()
        assert not any(name == "tags" for name, _key in LOG.current.inserted)
    finally:
        with raw.cursor() as cursor:
            cursor.execute("delete from tags where slug = %s", (slug,))
        raw.commit()
        raw.close()


def test_a_seeded_row_the_test_edits_is_put_back(engine):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models import Tag

    with session_scope() as session:
        tag = session.scalars(select(Tag).order_by(Tag.created_at).limit(1)).first()
        if tag is None:
            pytest.skip("no seeded tag")
        tag_id, before = tag.id, tag.description
        tag.description = "changed by a test"

    entry = ("tags", (str(tag_id),))
    assert entry in LOG.current.original
    assert restore(engine, {entry: LOG.current.original[entry]}, LOG.metadata) == []
    assert _value(engine, "select description from tags where id = :i", i=tag_id) == before


def test_a_seeded_row_the_test_deletes_comes_back_with_its_dependants(engine):
    """Deleting a seeded tag cascades to its links; teardown restores both."""
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models import Tag, TagLink

    with session_scope() as session:
        link = session.scalars(select(TagLink).limit(1)).first()
        if link is None:
            pytest.skip("no seeded tag link")
        tag_id, link_id = link.tag_id, link.id
    links = _value(engine, "select count(*) from tag_links where tag_id = :i", i=tag_id)

    with session_scope() as session:
        session.execute(Tag.__table__.delete().where(Tag.id == tag_id))

    window = LOG.current
    assert ("tags", (str(tag_id),)) in window.original
    assert ("tag_links", (str(link_id),)) in window.original
    assert restore(engine, dict(window.original), LOG.metadata) == []
    window.original.clear()
    assert _value(engine, "select count(*) from tag_links where tag_id = :i", i=tag_id) == links


def test_a_row_inserted_then_deleted_by_the_test_is_forgotten(engine):
    from src.core.db import session_scope

    slug = f"cleanup-gone-{uuid.uuid4().hex[:8]}"
    with session_scope() as session:
        tag = _tag(slug)
        session.add(tag)
        session.flush()
        entry = ("tags", (str(tag.id),))
        assert entry in LOG.current.inserted
        session.delete(tag)

    assert entry not in LOG.current.inserted
    assert entry not in LOG.current.original  # ours, so nothing to put back


def test_the_capture_reads_the_rows_a_statement_will_touch():
    assert _select_for("DELETE FROM recent_items WHERE recent_items.id = %(id)s::UUID", "DELETE") == (
        "recent_items", "SELECT DISTINCT row_to_json(recent_items.*)::text FROM recent_items "
                        "WHERE recent_items.id = %(id)s::UUID")
    table, sql = _select_for(
        "UPDATE tags SET usage_count=(SELECT count(*) FROM tag_links WHERE tag_links.tag_id = tags.id) "
        "WHERE tags.id = %(id)s RETURNING tags.id", "UPDATE")
    assert table == "tags" and sql.endswith("FROM tags WHERE tags.id = %(id)s")
    assert _select_for("DELETE FROM a USING b WHERE a.x = b.x", "DELETE")[1].endswith("FROM a, b WHERE a.x = b.x")
    assert _select_for("DELETE FROM audit_logs", "DELETE")[1].endswith("FROM audit_logs")
    assert _select_for("UPDATE a SET x = b.y FROM b WHERE a.id = b.id", "UPDATE") is None
    assert _select_for("DELETE FROM a; DELETE FROM b", "DELETE") is None


def test_a_scratch_database_is_not_the_real_one():
    """`tests/test_seed` builds a world in `<db>_scratch_<pid>`; those writes are not undone here."""
    from sqlalchemy.engine import make_url

    a = make_url("postgresql+psycopg2://u:p@localhost:5433/platform")
    assert _same_database(a, make_url("postgresql+psycopg2://x:y@localhost:5433/platform"))
    assert not _same_database(a, make_url("postgresql+psycopg2://u:p@localhost:5433/platform_scratch"))
