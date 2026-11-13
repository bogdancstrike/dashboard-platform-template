"""The collaboration seed (§47–49) builds a lived-in chat, wiki and notes —
and is safe to run again, which is what makes it the `--sync-collab` repair.

Run inside a transaction that is rolled back: the seed is exercised from an
empty collaboration state without disturbing the development database.
"""

from __future__ import annotations

from tests.seed_support import (  # noqa: F401
    scratch_database,
    world,
)

import pytest
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from tests.patching import patch_package

pytestmark = pytest.mark.database


@pytest.fixture()
def scratch(engine):
    connection = engine.connect()
    outer = connection.begin()
    session = Session(bind=connection)
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


def test_the_seed_builds_everything_once(scratch):
    from src.models.collab import (
        ChatChannel,
        DocLink,
        DocPage,
        DocRevision,
        DocSpace,
        ThreadRead,
    )
    from src.models.content import Comment
    from src.seed import collab

    session = scratch
    session.execute(delete(Comment).where(Comment.resource_type == "chat_channel"))
    for model in (ThreadRead, DocLink, DocRevision, DocPage, DocSpace, ChatChannel):
        session.execute(delete(model))
    session.execute(
        Comment.__table__.update()
        .where(Comment.resource_type.in_(("ticket", "task", "project", "customer")))
        .values(reactions=None)
    )

    first = collab.seed(session)
    assert first["channels"] == len(collab.CHANNELS) + len(collab.DIRECTS)
    assert first["messages"] > 40
    assert first["spaces"] == len(collab.SPACES)
    assert first["pages"] >= 9
    assert first["reactions"] > 0

    general = session.scalars(select(ChatChannel).where(ChatChannel.name == "general")).one()
    assert len(general.members) >= 5
    assert general.last_message_at is not None
    mentioned = session.scalars(
        select(Comment).where(Comment.resource_id == str(general.id), Comment.mentions.isnot(None))
    ).all()
    assert any(row.mentions for row in mentioned), "@names in the script resolve to people"
    leadership = session.scalars(select(ChatChannel).where(ChatChannel.name == "leadership")).one()
    assert leadership.visibility == "PRIVATE" and len(leadership.members) == 2

    meetings = session.scalars(select(DocSpace).where(DocSpace.kind == "MEETINGS")).one()
    assert meetings.key == "meetings"
    assert session.scalar(select(func.count()).select_from(DocRevision)) >= 2 * first["pages"]
    assert session.scalar(select(func.count()).select_from(DocLink)) >= 1

    again = collab.seed(session)
    assert again == {"channels": 0, "messages": 0, "reactions": 0, "spaces": 0, "pages": 0, "meetings": 0}


def test_without_people_there_is_nothing_to_seed(monkeypatch, scratch):
    from src.seed import collab

    patch_package(monkeypatch, collab, "_people", lambda session: ({}, []))
    assert set(collab.seed(scratch).values()) == {0}
