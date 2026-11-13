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

from tests.patching import patch_package

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
    from src.bootstrap import create_application
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


# ── Cleanup: undo exactly what the test did (tests/undo_log.py) ──────────


def pytest_terminal_summary(terminalreporter):
    from tests.undo_log import LOG

    if LOG.metadata is not None:
        terminalreporter.write_line(
            f"undo log: removed {LOG.swept} rows the suite inserted, put back {LOG.restored} it "
            f"changed; {len(LOG.leftovers)} could not be undone"
            + (": " + "; ".join(LOG.leftovers[:5]) if LOG.leftovers else "")
        )


@pytest.fixture(scope="session")
def _undo_log(has_database):
    """Listen to this process's statements once per session.

    Whatever is written outside a test — by a module- or session-scoped
    fixture — is undone when the session ends: a fixture's rows outlive the
    test that first asked for them, but not the run.
    """
    if not has_database:
        yield None
        return
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    import src.models as models
    from src.core.db import get_engine
    from tests.undo_log import LOG

    engine = get_engine()
    LOG.begin_session(engine.url, models.Base.metadata)
    event.listen(Engine, "before_cursor_execute", LOG.before)
    event.listen(Engine, "after_cursor_execute", LOG.after)
    try:
        yield engine
    finally:
        event.remove(Engine, "before_cursor_execute", LOG.before)
        event.remove(Engine, "after_cursor_execute", LOG.after)
        LOG.undo(engine, LOG.outside)
        LOG.active = False


@pytest.fixture(autouse=True)
def _remove_what_the_test_created(_undo_log):
    """Delete the rows this test inserted and put back the rows it changed.

    Runs for every test rather than being opted into: cleanup somebody has to
    remember is cleanup that stops happening. Autouse and function-scoped, so
    it starts before the test's own function fixtures and finishes after their
    teardown.
    """
    engine = _undo_log
    if engine is None:
        yield
        return
    from tests.undo_log import LOG

    LOG.start()
    try:
        yield
    finally:
        window = LOG.stop()
        refused = LOG.undo(engine, window) if window else []
        assert not refused, (
            "the test left the database in a state its undo could not reverse "
            "(usually a seeded row now pointing at a row the test created): " + "; ".join(refused)
        )


@pytest.fixture(autouse=True)
def _flags_as_shipped(_undo_log, monkeypatch):
    """Every feature flag reads as on — unless this test changed it.

    The flag gate (`core/features`) reads the shared database, where people
    switch features off on purpose (that is what a flag is for, and the UI
    audits toggle every one). A suite that obeyed those switches would fail
    whenever somebody was using the flags screen. So a flag row this test did
    not write reads as shipped — on, everyone, no targeting — and one it did
    write (through the API, or by inserting it) reads exactly as stored. Tests
    that drive the gate directly patch `features.snapshot` themselves.
    """
    if _undo_log is None:
        yield
        return
    from dataclasses import fields, replace

    from src.core import features
    from tests.undo_log import LOG

    real = features._read_rows

    def as_shipped():
        states = as_shipped.source()
        window = LOG.current
        touched = {key[0] for table, key in [*window.original, *window.inserted] if table == "feature_flags"}
        mine: set[str] = set()
        if touched:
            from sqlalchemy import select

            from src.core.db import session_scope
            from src.models.platform import FeatureFlag

            with session_scope() as session:
                mine = set(session.scalars(select(FeatureFlag.key).where(
                    FeatureFlag.id.in_([__import__("uuid").UUID(t) for t in touched]))))
        names = {f.name for f in fields(next(iter(states.values())))} if states else set()
        on = {"enabled": True, "rollout_percentage": 100}
        on.update({name: () for name in names if name.startswith("target_")})
        return {key: state if key in mine else replace(state, **on) for key, state in states.items()}

    as_shipped.source = real  # what the database holds; a test may swap it
    patch_package(monkeypatch, features, "_read_rows", as_shipped)
    patch_package(monkeypatch, features, "_snapshot", None)
    yield
    features._snapshot = None


#: The five seeded personas, by the names the realm and the seed give them.
#:
#: Test claims have to carry these. `core/auth/users.sync_user` trusts the identity
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
