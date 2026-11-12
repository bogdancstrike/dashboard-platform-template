"""Fixtures for the performance budgets (docs/testing/performance.md).

Everything here runs in-process against the seeded database the stack serves
(`make test-perf`, or `make test-backend-db`): no network, so a number measures
the code and its SQL rather than the machine's network stack.

* :class:`QueryCounter` counts the statements one request sends to PostgreSQL —
  the unit the N+1 budgets are written in.
* ``as_persona`` signs a request in as one of the seeded personas the same way
  the rest of the suite does: a patched ``verify_token`` returning that
  persona's real claims, so the principal comes from the real users/roles rows.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass, field

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX

ROLES = {"admin": "administrator", "manager": "manager", "operator": "operator", "analyst": "analyst", "user": "user"}


#: Writes that happen at most once a minute per session whatever the request
#: is (`core/auth`: `last_seen_at`, `last_login_at`, the current-session flag).
#: They would make a count depend on the clock, so they are not counted.
PERIODIC = ("UPDATE user_sessions", "UPDATE users SET last_login_at")


@dataclass
class QueryCounter:
    statements: list[str] = field(default_factory=list)

    @property
    def counted(self) -> list[str]:
        return [s for s in self.statements if not s.startswith(PERIODIC)]

    @property
    def count(self) -> int:
        return len(self.counted)

    def report(self, limit: int = 12) -> str:
        from collections import Counter

        common = Counter(s.split(" FROM ")[0][:60] + " FROM " + s.split(" FROM ")[-1][:50] if " FROM " in s else s[:110]
                         for s in self.counted).most_common(limit)
        return "\n".join(f"  {n:3d} × {text}" for text, n in common)


@pytest.fixture()
def count_queries(engine):
    """``with count_queries() as q: ...`` → ``q.count`` statements were executed."""
    from sqlalchemy import event

    @contextmanager
    def counting():
        counter = QueryCounter()

        def _record(conn, cursor, statement, params, context, executemany):  # noqa: ARG001
            counter.statements.append(" ".join(statement.split()))

        event.listen(engine, "before_cursor_execute", _record)
        try:
            yield counter
        finally:
            event.remove(engine, "before_cursor_execute", _record)

    return counting


@pytest.fixture()
def as_persona(monkeypatch) -> Callable[[str], dict[str, str]]:
    def _sign_in(persona: str) -> dict[str, str]:
        claims = persona_claims(persona, ROLES[persona], sid=f"perf-{persona}")
        monkeypatch.setattr("src.core.auth.verify_token", lambda _token: claims)
        return {"Authorization": f"Bearer perf-{persona}", "Content-Type": "application/json"}

    return _sign_in


@pytest.fixture(scope="module")
def sample_ids(app, has_database):
    """A few record ids per dataset, read once through the API."""
    if not has_database:
        pytest.skip("set TEST_DATABASE_URL to run the performance budgets")
    import src.core.auth as auth

    original = auth.verify_token
    auth.verify_token = lambda _token: persona_claims("admin", "administrator", sid="perf-admin")
    try:
        client = app.test_client()
        headers = {"Authorization": "Bearer perf-admin"}
        ids: dict[str, list[str]] = {}
        for dataset in ("task", "ticket", "project", "customer", "order", "device"):
            body = client.post(f"{PREFIX}/api/explorer/query", headers=headers,
                               json={"resource_type": dataset, "page_size": 5}).get_json()
            ids[dataset] = [row["id"] for row in body.get("items", [])]
        boards = client.get(f"{PREFIX}/api/kanban/boards", headers=headers).get_json().get("items") or []
        ids["board"] = [b["id"] for b in boards[:1]]
        return ids
    finally:
        auth.verify_token = original


def timed(fn: Callable[[], object], repeat: int = 5) -> tuple[float, float]:
    """(median, max) wall time in ms over ``repeat`` calls, after one warm-up."""
    fn()
    samples = []
    for _ in range(repeat):
        started = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - started) * 1000)
    samples.sort()
    return samples[len(samples) // 2], samples[-1]
