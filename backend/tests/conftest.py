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
os.environ.setdefault("CACHE_ENABLED", "false")
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
