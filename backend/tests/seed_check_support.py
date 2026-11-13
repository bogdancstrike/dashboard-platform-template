"""Shared helpers and fixtures for the seed check tests."""

from __future__ import annotations

import os

import pytest

pytestmark = pytest.mark.database


@pytest.fixture(scope="module")
def scratch(has_database, tmp_path_factory):
    """A small seeded world in the scratch database, shared by this module."""
    if not has_database:
        pytest.skip("set TEST_DATABASE_URL to run tests that need PostgreSQL")
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    from src.core import db as db_module
    from src.seed import runner

    target = make_url(os.environ["TEST_DATABASE_URL"])
    name = f"{target.database}_scratch_{os.getpid()}"
    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        if not connection.scalar(text("select 1 from pg_database where datname = :n"), {"n": name}):
            connection.execute(text(f'create database "{name}"'))
    admin.dispose()

    previous = db_module._engine, db_module._SessionLocal
    db_module._engine = create_engine(target.set(database=name), future=True)
    db_module._SessionLocal = None
    try:
        runner.drop_schema(db_module._engine)
        runner.bootstrap_schema(db_module._engine)
        from src.core.storage import LocalStorage
        from src.seed import blobs
        from src.seed import exports as export_files

        store = LocalStorage(str(tmp_path_factory.mktemp("objects")), secret="test", prefix="/files")
        with db_module.session_scope() as session:
            runner.run(session, scale="small", seed=29)
            blobs.materialise(session, store)
            export_files.materialise(session, store)
        yield db_module._engine
    finally:
        db_module._engine.dispose()
        db_module._engine, db_module._SessionLocal = previous
        from tests.seed_support import drop_scratch

        drop_scratch(target, name)


@pytest.fixture()
def session(scratch):
    """A session on the scratch world whose every change is rolled back."""
    from src.core.db import new_session

    s = new_session()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _first(session, model, *where):
    from sqlalchemy import select

    return session.scalars(select(model).where(*where).limit(1)).first()


def _rows(session, model, n, *where):
    from sqlalchemy import select

    rows = session.scalars(select(model).where(*where).order_by(model.id).limit(n)).all()
    if len(rows) < n:
        pytest.skip(f"the small seed has fewer than {n} {model.__tablename__}")
    return rows
