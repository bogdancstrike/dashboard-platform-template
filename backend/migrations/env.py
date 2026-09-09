"""Where a migration gets its database and its target schema.

Two decisions carry the file:

* **The URL comes from `Config`**, not from `alembic.ini`. The application, the
  seed, the tests and the migrations then read one setting, and "which
  database did that run against" has one answer. Two overrides exist for the
  callers that address a *particular* database rather than the configured one:
  `-x url=…` on the command line, and `sqlalchemy.url` set on the config
  object by a caller in-process — the seed stamps the engine it just built the
  schema on, which is not always the configured one.
* **The target is the ORM's own metadata.** Importing `src.models` registers
  every table, so `--autogenerate` compares the live database against the
  models rather than against a hand-written description of them. A schema
  described twice is a schema that disagrees with itself by the end of the
  week.

`compare_type` and `compare_server_default` are on: without them a column
whose type or default changed in a model produces an empty revision, which is
worse than no revision at all because it looks like agreement.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from src.config import Config
from src.models import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    """The database to migrate.

    In precedence order: `-x url=…`, a URL a caller set on the config, and
    otherwise the one the application itself uses.
    """
    return (
        context.get_x_argument(as_dictionary=True).get("url")
        or config.get_main_option("sqlalchemy.url")
        or Config.DATABASE_URL
    )


def run_migrations_offline() -> None:
    """Emit SQL to stdout, for a database somebody else runs it against.

    A deployment where the person applying the change is not the person who
    wrote it needs the statements to review, and `alembic upgrade head --sql`
    is how they get them.
    """
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    section = config.get_section(config.config_ini_section) or {}
    section["sqlalchemy.url"] = _url()
    connectable = engine_from_config(section, prefix="sqlalchemy.", poolclass=pool.NullPool)

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            # One transaction for the whole upgrade: a migration that fails
            # half way leaves the database at the revision it started from
            # rather than in a state no revision describes.
            transaction_per_migration=False,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
