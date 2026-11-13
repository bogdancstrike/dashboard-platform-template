"""Shared helpers and fixtures for the seed tests."""

from __future__ import annotations

import os

import pytest

from src.seed import runner
from src.seed.world import SMALL

SEED = 20260101


@pytest.fixture(scope="module")
def world():
    return runner.generate(scale=SMALL, seed=SEED)


@pytest.fixture()
def scratch_database(has_database):
    """A database of this test's own, created on demand and left behind empty.

    This is the one test that drops every table, and `make test-backend-db`
    points `TEST_DATABASE_URL` at the *running stack's* database — so pointed
    at `platform` it would quietly replace the demo dataset with a small one,
    and every Playwright run afterwards would measure something other than what
    `docker compose up` produced. That failure is silent, which is what makes
    it worth a fixture: the suite passes, the seed is verified, and the data
    everything else was checked against is gone.

    So the destructive work happens in `<database>_scratch_<pid>`, and the engine the
    seed runner uses is swapped for its duration.
    """
    url = os.getenv("TEST_DATABASE_URL")
    if not url:  # pragma: no cover - guarded by the `database` marker
        pytest.skip("set TEST_DATABASE_URL to run tests that need PostgreSQL")

    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    target = make_url(url)
    # Per process, and dropped afterwards: two suites running at once must not
    # reseed each other's world mid-test.
    scratch_name = f"{target.database}_scratch_{os.getpid()}"
    scratch = target.set(database=scratch_name)

    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            exists = connection.scalar(
                text("select 1 from pg_database where datname = :name"), {"name": scratch_name}
            )
            if not exists:
                # The name is derived from a URL the developer supplied, not
                # from a request, and quoting it keeps a database called
                # "platform-test" from becoming a syntax error.
                connection.execute(text(f'create database "{scratch_name}"'))
    except Exception as exc:  # pragma: no cover - no permission to create one
        pytest.skip(f"cannot create a scratch database ({exc.__class__.__name__})")
    finally:
        admin.dispose()

    from src.core import db as db_module

    previous_engine, previous_maker = db_module._engine, db_module._SessionLocal
    db_module._engine = create_engine(scratch, future=True)
    db_module._SessionLocal = None
    try:
        yield db_module._engine
    finally:
        db_module._engine.dispose()
        db_module._engine, db_module._SessionLocal = previous_engine, previous_maker
        drop_scratch(target, scratch_name)


def drop_scratch(target, name: str) -> None:
    """Remove a per-process scratch database (best effort)."""
    from sqlalchemy import create_engine, text

    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
    except Exception:  # noqa: BLE001 - leaving one behind is harmless
        pass
    finally:
        admin.dispose()
