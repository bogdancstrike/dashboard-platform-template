"""Alembic: the schema is versioned, and the version is the models'.

Two descriptions of one schema is the defect this suite exists to catch. The
models are the description everything else reads — the seed's `create_all`, the
`--sync-schema` repair, the query builders' `FieldSet`s — so a revision that
says something slightly different is a database that disagrees with the code
that reads it, and the disagreement shows up as a 500 on one deployment and
nowhere else.

So the claim is not "the migrations run". It is:

* **`upgrade head` on an empty database produces exactly what `create_all`
  does.** Asserted by asking Alembic itself: after the upgrade, autogenerate
  finds *nothing* to do. That is the same comparison `alembic revision
  --autogenerate` makes, so a model changed without a revision fails here
  rather than in production.
* **`downgrade base` puts it back to empty**, because a migration that cannot
  be undone is a migration nobody dares apply.
* **One linear history.** Two heads is a repository where `upgrade head` has
  two answers and neither is wrong.

Every test runs against a **scratch database it creates and drops**, never the
development one: a suite that migrated the database the rest of the tests read
would be a suite that decides its own fixtures.
"""

from __future__ import annotations

import os
import re
from urllib.parse import urlsplit, urlunsplit

import pytest
from sqlalchemy import create_engine, inspect, text

pytestmark = [
    pytest.mark.database,
    # `compare_metadata` sorts the tables to compare them and says so when it
    # cannot: users → departments → users is a real cycle, and it is the one
    # the initial revision closes with `ADD CONSTRAINT` after the tables. The
    # warning is about the sort, not about the schema.
    pytest.mark.filterwarnings("ignore:Cannot correctly sort tables:Warning"),
]

#: The revision that creates everything. There is exactly one, by construction.
BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _config(url: str):
    """Alembic pointed at one database, with this repository's scripts."""
    from alembic.config import Config as AlembicConfig

    config = AlembicConfig(os.path.join(BACKEND, "alembic.ini"))
    config.set_main_option("script_location", os.path.join(BACKEND, "migrations"))
    # The same override the deployment uses (`-x url=…`), so the test exercises
    # the path `env.py` actually offers rather than a private hook.
    config.cmd_opts = type("Opts", (), {"x": [f"url={url}"]})()
    return config


@pytest.fixture()
def scratch(has_database):
    """An empty database, created for one test and dropped after it.

    `CREATE DATABASE` cannot run inside a transaction, hence the autocommit
    connection; and it cannot run against the database being created, hence
    connecting to the configured one first.
    """
    if not has_database:
        pytest.skip("set TEST_DATABASE_URL to run tests that need PostgreSQL")

    from src.config import Config

    parts = urlsplit(Config.DATABASE_URL)
    name = "nucleus_migrations_check"
    url = urlunsplit(parts._replace(path=f"/{name}"))

    admin = create_engine(Config.DATABASE_URL, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield url
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _differences(url: str) -> list:
    """What autogenerate would still write, which must be nothing."""
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext

    from src.models import Base

    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(
                connection,
                opts={"compare_type": True, "compare_server_default": True},
            )
            return compare_metadata(context, Base.metadata)
    finally:
        engine.dispose()


def test_upgrade_head_builds_the_schema_the_models_describe(scratch):
    from alembic import command

    command.upgrade(_config(scratch), "head")

    # Alembic's own comparison, which is the one that matters: anything in
    # this list is something `--autogenerate` would write into the next
    # revision, which means the database and the models differ.
    differences = _differences(scratch)
    assert differences == [], differences


def test_every_table_the_orm_maps_exists_after_the_upgrade(scratch):
    """The same claim from the other side, in case a comparison is too clever.

    `compare_metadata` is a library call; this is a count of tables. If the
    two ever disagreed, the honest reading is that the library was configured
    to ignore something.
    """
    from alembic import command

    from src.models import Base

    command.upgrade(_config(scratch), "head")

    engine = create_engine(scratch)
    try:
        present = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    mapped = set(Base.metadata.tables)
    assert mapped <= present, mapped - present
    # And nothing else, apart from Alembic's own bookkeeping.
    assert present - mapped == {"alembic_version"}


def test_downgrade_leaves_an_empty_database(scratch):
    from alembic import command

    config = _config(scratch)
    command.upgrade(config, "head")
    command.downgrade(config, "base")

    engine = create_engine(scratch)
    try:
        present = set(inspect(engine).get_table_names())
    finally:
        engine.dispose()

    # Alembic keeps its version table; nothing of ours survives.
    assert present <= {"alembic_version"}, present


def test_the_history_is_linear_and_reversible():
    """One head, and every revision can be undone.

    Two heads means `upgrade head` has two answers. A revision with an empty
    `downgrade` means the version before it is unreachable, which is the state
    in which nobody applies the migration at all.
    """
    from alembic.script import ScriptDirectory

    scripts = ScriptDirectory.from_config(_config("postgresql+psycopg2://unused/unused"))

    assert len(scripts.get_heads()) == 1, scripts.get_heads()
    revisions = list(scripts.walk_revisions())
    assert revisions, "no migrations at all"
    for revision in revisions:
        source = open(revision.path, encoding="utf-8").read()
        body = source.split("def downgrade()", 1)[1]
        if "op." in body:
            continue
        # One exemption, and it has to be argued: a revision that *removes*
        # something already dead has no previous state worth restoring, and
        # recreating it can even block the revision below from running. It
        # says so in a module-level `IRREVERSIBLE`, with a reason long enough
        # to be one.
        claim = re.search(r'IRREVERSIBLE\s*=\s*\(?\s*(.+?)\)?\n\n', source, re.S)
        assert claim, f"{revision.revision} cannot be undone and does not say why"
        assert len(claim.group(1)) > 80, f"{revision.revision}'s reason is not one"


def test_the_seeds_create_all_and_the_migration_agree_on_the_naming_convention():
    """A constraint the migration names differently is a migration that runs
    on one database and fails on the next.

    The convention lives in `models/base.py`; this asserts the revision uses
    `op.f(...)` — Alembic's way of saying "this name came from the convention"
    — rather than letting PostgreSQL invent one.
    """
    from alembic.script import ScriptDirectory

    scripts = ScriptDirectory.from_config(_config("postgresql+psycopg2://unused/unused"))
    initial = list(scripts.walk_revisions())[-1]
    source = open(initial.path, encoding="utf-8").read()

    assert "op.f('pk_organizations')" in source
    # A foreign key that is not in a cycle keeps its name inline.
    assert "op.f('fk_tasks_project_id_projects')" in source
    # The eleven that close the users → departments → users cycle are added
    # after the tables, by name, because no CREATE TABLE could carry them.
    assert "op.create_foreign_key(\n        'fk_users_department_id_departments'" in source


def test_a_database_built_from_the_models_is_recorded_as_being_at_head(scratch):
    """The baseline problem, which is how migrations usually first go wrong.

    A first `docker compose up` builds the schema from the models, because
    needing two commands to get a working stack is a worse first five minutes
    than owning a version table. But a database that has every table and no
    recorded revision is a database Alembic believes is empty — and the first
    `make migrate` on it then tries to create all fifty-seven tables. So the
    seed stamps what it built.
    """
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine

    from src.models import Base
    from src.seed import runner

    engine = create_engine(scratch)
    try:
        Base.metadata.create_all(engine)
        stamped = runner.stamp_head(engine)

        head = ScriptDirectory.from_config(_config(scratch)).get_current_head()
        assert stamped == head

        # And nothing to migrate: what `create_all` built is what the
        # revisions describe, which is the same claim as the first test in
        # this file, reached the other way round.
        assert _differences(scratch) == []
    finally:
        engine.dispose()


def test_a_stamp_never_overwrites_a_revision_the_database_already_carries(scratch):
    """Stamping is a record, not a decision.

    Stamping a database that is *behind* would say a migration has run when it
    has not, and the next upgrade would skip it — the one lie in this area that
    turns a pending change into missing columns nobody notices until a query
    fails. So it only ever writes into an empty version table.
    """
    from alembic import command
    from sqlalchemy import create_engine

    from src.models import Base
    from src.seed import runner

    engine = create_engine(scratch)
    try:
        Base.metadata.create_all(engine)
        assert runner.stamp_head(engine) is not None
        # Second time: already recorded, so nothing to do.
        assert runner.stamp_head(engine) is None

        # And a database deliberately parked at `base` is left there.
        command.stamp(_config(scratch), "base")
        assert runner.stamp_head(engine) is not None  # base is an empty table
    finally:
        engine.dispose()
