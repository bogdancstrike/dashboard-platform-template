"""Shared fixtures.

The default environment points every dependency at a closed port. That is
deliberate: the suite must run on a laptop with nothing installed, and a
dependency that is *refused* fails in a millisecond where one that is merely
absent costs a connect timeout per test. Tests that need a real database ask
for the `database` marker and are skipped without `TEST_DATABASE_URL`.
"""

from __future__ import annotations

import os

import pytest

#: A port nothing listens on, so connections are refused immediately.
_CLOSED = "127.0.0.1:1"

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("SERVICE_NAME", "platform-api-test")
os.environ.setdefault(
    "DATABASE_URL", os.getenv("TEST_DATABASE_URL", f"postgresql+psycopg2://t:t@{_CLOSED}/t")
)
# Off by default, for the reason above: a closed Redis costs a connect timeout
# on the first call and then disables itself, but "then" is one test late.
#
# `TEST_REDIS_URL` turns it on for the tests that assert the *caching* — which
# cannot be asserted against a cache that is switched off, and which are marked
# `cache` and skipped without it. The same shape as `TEST_DATABASE_URL`.
os.environ.setdefault("CACHE_ENABLED", "true" if os.getenv("TEST_REDIS_URL") else "false")
if os.getenv("TEST_REDIS_URL"):
    os.environ.setdefault("REDIS_URL", os.environ["TEST_REDIS_URL"])
os.environ.setdefault("KEYCLOAK_INTERNAL_URL", f"http://{_CLOSED}")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:5174")
os.environ.setdefault("ENABLE_TRACING", "false")


@pytest.fixture(scope="session")
def app():
    from src.api.app import create_application
    from src.core.errors import ConflictError

    application = create_application()
    application.config.update(TESTING=True)

    # Registered here rather than inside the test that uses it: Flask refuses
    # new routes once an application has served its first request, and the app
    # is built once for the whole session.
    @application.get("/__error_probe")
    def _error_probe():
        raise ConflictError("already exists", details={"id": "42"})

    return application


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture(scope="session")
def has_database() -> bool:
    return bool(os.getenv("TEST_DATABASE_URL"))


@pytest.fixture(scope="session")
def engine(has_database):
    """The configured engine, for the few tests that talk to the schema itself."""
    if not has_database:
        pytest.skip("set TEST_DATABASE_URL to run tests that need PostgreSQL")
    from src.core.db import get_engine

    return get_engine()


@pytest.fixture(autouse=True)
def _skip_without_database(request, has_database):
    if request.node.get_closest_marker("database") and not has_database:
        pytest.skip("set TEST_DATABASE_URL to run tests that need PostgreSQL")
    if request.node.get_closest_marker("cache") and not os.getenv("TEST_REDIS_URL"):
        pytest.skip("set TEST_REDIS_URL to run tests that need Redis")


#: The models a `database`-marked test is allowed to leave rows in.
#:
#: This exists because the suite had no cleanup at all and it showed: 560
#: dashboards, 151 reports and 38 announcements had accumulated in the
#: development database, one test run at a time. Every one was invisible in
#: the suite's own output — the tests passed — and perfectly visible on the
#: pages a reviewer opens, where a gallery of "E2E board" and a noticeboard of
#: "A notice" is the first thing they see.
#:
#: A transaction rolled back around each test would be the textbook answer and
#: does not work here: the app opens its own sessions through `session_scope`
#: and commits them, which is the behaviour under test. Deleting by age is what
#: is actually available, and it is safe because seeded rows are older than the
#: test that just ran.
#:
#: Named as *models* rather than as table names, and ordered by the metadata
#: rather than by hand — the first version typed the names out and got
#: `file_objects` wrong, which turned every database test's teardown into an
#: error.
TEST_OWNED_MODELS: tuple[str, ...] = (
    # Children first, always — asserted by
    # `test_cleanup_order_respects_the_foreign_keys`, which caught this list
    # having the first two the wrong way round.
    "AnnouncementReceipt", "Announcement",
    "AlertRuleFire", "AlertRuleRun", "AlertRule",
    "BoardCard", "BoardLane", "Board",
    "DashboardWidget", "Dashboard",
    "ResourceShare", "SavedSearch", "Report",
    # Mail before files: an attachment points at a `FileObject`, so it goes
    # first — and attachments before messages before threads.
    # `test_cleanup_order_respects_the_foreign_keys` caught both of these,
    # which is exactly what that test is for.
    "EmailAttachment", "EmailMessage", "EmailThread",
    "Comment", "FileObject", "Folder",
    # Tasks, because an automation's TASK action creates real ones and the
    # records API creates them too — 296 had accumulated in the development
    # database from `test_raising_a_task_puts_it_in_the_normal_queue` alone,
    # each run raising up to fifty. Nothing in this list points at a task by
    # foreign key, so its position only has to be before the audit rows that
    # describe it.
    # `calendar_events` points at `tasks`, so it goes first —
    # `test_cleanup_order_respects_the_foreign_keys` caught this pair the wrong
    # way round, which is exactly what that test is for.
    "CalendarEvent", "Task",
    # Written as a *side effect* of every audited test write, so they
    # accumulate faster than anything else — and a demo `/activity` full of
    # "1m ago · updated the Viewer role" from a test run is a feed nobody can
    # read.
    #
    # Here rather than at the end, which is where they used to be, because an
    # `ActivityEntry` points at a *project* and a project points at a
    # *department*: leaving these last put `Project` after `Department` and
    # `Department` after `ActivityEntry`, which is a cycle no ordering
    # satisfies. Nothing in this list points at an audit or activity row, so
    # they are free to move — and position here is about foreign keys, not
    # about how fast a table fills up.
    "ActivityEntry", "AuditLog",
    # The business records, added when `/import` (§29) started creating them in
    # bulk: an import test that loads three customers leaves three customers,
    # and the demo dataset gained "Import Test Customer 1" the first time
    # anybody ran the suite.
    #
    # Children first, as always: `devices` and `tickets` reference `projects`,
    # and `orders`, `projects` and `tickets` all reference `customers`. And the
    # whole block precedes `Department`, because an order and a project both
    # name one. `test_cleanup_order_respects_the_foreign_keys` found three
    # wrong placements of this block in a row, which is the clearest case yet
    # for it existing.
    "Device", "Order", "Ticket", "Project", "Customer",
    "Notification", "Favorite", "RecentItem",
    # Every authenticated request now records its session (§41), so a test
    # that makes one HTTP call leaves a row — the same reason `SystemLog` is
    # in this list. Nothing points at a session.
    #
    # The sign-in and security rows beside it because `test_security` makes
    # its own: a *failed* sign-in is the row that page exists to show, so a
    # test about one must not depend on the seed's coin flip having left the
    # persona any.
    "UserSession", "LoginEvent", "SecurityEvent",
    # `test_groups` makes its own groups. The `user_groups` association has no
    # timestamps of its own, so it is cleared by the service's own writes —
    # `remove` empties the membership before retiring the row, which is what
    # stops a soft-deleted group going on granting its permissions.
    "Group",
    # `test_organizations` makes its own departments. A department points at
    # its parent, so the tests build shallow trees and delete them by age —
    # which reaches a child and its parent in the same sweep.
    "Department",
    # `test_api_clients` registers its own clients, and a credential points at
    # one — children first, as always. The request logs are never written by a
    # test and have no `created_at`, so they are not here.
    "ApiCredential", "ApiClient",
    # `test_jobs` makes its own jobs rather than editing seeded ones, so they
    # have to be swept — and before the audit rows that describe them.
    "BackgroundJob",
    # `test_imports` begins a run per test and discards it, and a discard
    # *keeps the record* — deliberately, because the attempt is worth having
    # recorded (§29). Which meant 200 cancelled runs in the demo database
    # before this line existed. Nothing points at an import run.
    "ImportRun",
    # Written by `core/logsink` for *every* API request, so a database test
    # that makes one HTTP call leaves a line behind and a suite of five
    # hundred leaves five hundred. Last in the list because nothing points at
    # a log line.
    "SystemLog",
)

#: The column that says when a row was made, for the models whose is not
#: `created_at`.
#:
#: `SystemLog` carries no `TimestampMixin`: a log line's one timestamp is the
#: moment it describes, and a second column recording when the row was
#: *inserted* would be the same value under a different name. Declared here
#: rather than guessed, and asserted below — a model added to the list without
#: either `created_at` or an entry here fails at collection instead of erroring
#: in every test's teardown.
TEST_OWNED_TIME_COLUMN: dict[str, str] = {"SystemLog": "logged_at"}


def _tables_to_clean() -> list[tuple[str, str]]:
    """The owned tables, children first, resolved from the models.

    Each entry is `(table, time column)`. The names come from `__tablename__`
    rather than being typed out — the first version typed them and got
    `file_objects` wrong, which turned every database test's teardown into an
    error. The *order* is `TEST_OWNED_MODELS` as written:
    `metadata.sorted_tables` would derive it, but it warns loudly about a
    pre-existing cycle between `departments`, `teams` and `users`, and 227
    warnings per run to avoid ordering sixteen names is a poor trade.
    `test_cleanup_order_respects_the_foreign_keys` is what keeps the order
    honest.

    The column is derived rather than assumed to be `created_at`, because not
    every model has one — and a `DELETE` naming a column that is not there
    fails the teardown of every test in the suite at once.
    """
    import src.models as models

    tables: list[tuple[str, str]] = []
    for name in TEST_OWNED_MODELS:
        model = getattr(models, name, None)
        assert model is not None, f"{name} is not exported from src.models"
        column = TEST_OWNED_TIME_COLUMN.get(name, "created_at")
        assert hasattr(model, column), (
            f"{name} has no {column!r} to bound the cleanup by — give it an "
            f"entry in TEST_OWNED_TIME_COLUMN"
        )
        tables.append((model.__tablename__, column))
    return tables


@pytest.fixture(autouse=True)
def _remove_what_the_test_created(request, has_database):
    """Delete rows a `database` test created, and nothing older.

    Runs for every test rather than being opted into: cleanup somebody has to
    remember is cleanup that stops happening, which is exactly how the numbers
    above were reached.

    Bounded by the instant the test started, so a row seeded months ago is
    never in range even if a test edited it — editing does not move
    `created_at`.
    """
    if not request.node.get_closest_marker("database") or not has_database:
        yield
        return

    from sqlalchemy import text

    from src.core.db import get_engine

    engine = get_engine()
    # `begin()` rather than `connect()`: a read on a bare connection leaves an
    # open transaction until the connection is returned, and a pooled
    # connection handed out again inside that transaction serves a *stale
    # snapshot* — which showed up as an audit export that was 34 rows shorter
    # than the count beside it.
    with engine.begin() as connection:
        started = connection.execute(text("SELECT now()")).scalar()

    yield

    with engine.begin() as connection:
        for table, column in _tables_to_clean():
            connection.execute(
                text(f'DELETE FROM "{table}" WHERE "{column}" > :since'), {"since": started}
            )
        # And the derived counts those deletions invalidate.
        #
        # Deleting a row is not the whole undo when something *else* caches a
        # count of it: a test that tags a seeded record leaves `tag_links`
        # behind for the sweep and `tags.usage_count` incremented on a row
        # seeded months ago, which nothing here is allowed to delete. So
        # `--check` reported "1 tags disagree with their links" after every
        # backend run against the demo database, and the fix was a repair
        # somebody had to remember to run.
        #
        # Recomputed rather than decremented, for the same reason the service
        # recomputes: a derived column has one truth and it is the links.
        connection.execute(
            text(
                'UPDATE "tags" SET usage_count = ('
                '  SELECT count(*) FROM "tag_links" WHERE "tag_links".tag_id = "tags".id'
                ') WHERE usage_count <> ('
                '  SELECT count(*) FROM "tag_links" WHERE "tag_links".tag_id = "tags".id'
                ')'
            )
        )


#: The five seeded personas, by the names the realm and the seed give them.
#:
#: Test claims have to carry these. `core/auth._sync_user` trusts the identity
#: provider for a person's display name — correctly, since the IdP owns it — so
#: a synthetic claim of `name: "Admin"` silently renames Ada Administrator in
#: the demo database, and the next person to open the app finds a directory of
#: people called "Admin", "Manager" and "User".
PERSONA_NAMES: dict[str, str] = {
    "admin": "Ada Administrator",
    "manager": "Mara Manager",
    "operator": "Otto Operator",
    "analyst": "Ana Analyst",
    "user": "Uma User",
}


def persona_claims(username: str, role: str, *, sid: str = "") -> dict:
    """The JWT claims a signed-in persona would actually arrive with."""
    return {
        "sub": "",
        "email": f"{username}@nucleus.example",
        "preferred_username": username,
        "name": PERSONA_NAMES.get(username, username.title()),
        "sid": sid or f"test-{username}",
        "realm_access": {"roles": [role]},
    }
