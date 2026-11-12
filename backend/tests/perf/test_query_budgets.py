"""SQL statement budgets per endpoint, and the N+1 detector.

Two kinds of assertion, because they catch different regressions:

* **Budgets** — each key endpoint sends at most N statements for one request,
  N being what it sends today plus a little headroom. A new lazy load, a
  per-row lookup or a second copy of the auth queries breaks this first.
* **Flat in the page size** — a list asked for 5 rows and for 100 rows must send
  the *same* number of statements. That is the definition of "no N+1", and it
  holds whatever the seed data looks like.

Every authenticated request has a fixed cost, counted in each budget: the
principal (user, its role and groups — 3), the session row (1) and the
request-log line (1). `test_auth_overhead_is_constant` pins that floor, so a
change to it shows up once instead of in every budget.

Run: ``make test-perf`` (needs the stack's PostgreSQL). ``PERF_MEASURE=1``
prints the measured counts, for re-baselining after a deliberate change.
"""

from __future__ import annotations

import os

import pytest

from tests.perf.conftest import PREFIX

pytestmark = [pytest.mark.database]

MEASURE = bool(os.getenv("PERF_MEASURE"))

#: Statements one authenticated request costs before the handler runs a query.
AUTH_FLOOR = 5

#: (method, path, body, budget). `{task}` etc. are filled from `sample_ids`.
#: Budgets were measured on the seeded data and rounded up by a small margin;
#: the margin is for harmless drift (one more lookup), not for a loop.
BUDGETS: list[tuple[str, str, dict | None, int]] = [
    ("GET", "/api/me", None, 12),
    ("GET", "/notifications/counts", None, 10),
    ("GET", "/notifications?page_size=20", None, 12),
    ("GET", "/dashboard/alerts", None, 12),
    ("GET", "/api/activity?page_size=10", None, 10),
    ("GET", "/favorites", None, 8),
    ("GET", "/recents", None, 9),
    ("GET", "/api/announcements", None, 13),
    ("POST", "/api/explorer/query", {"resource_type": "ticket", "facets": True, "page_size": 25}, 14),
    ("POST", "/api/explorer/query", {"resource_type": "order", "facets": True, "page_size": 50}, 14),
    ("POST", "/api/explorer/insights", {"resource_type": "order"}, 17),
    ("GET", "/api/records/ticket/{ticket}", None, 9),
    ("GET", "/api/records/project/{project}", None, 9),
    ("GET", "/api/audit/timeline?resource_type=ticket&resource_id={ticket}", None, 9),
    ("GET", "/api/search/global?q=acme", None, 16),
    ("GET", "/api/kanban/boards", None, 12),
    ("GET", "/api/kanban/boards/{board}", None, 16),
    ("GET", "/api/files?page_size=25", None, 10),
    ("GET", "/exports?page_size=25", None, 13),
    ("GET", "/api/mail/threads?page_size=25", None, 14),
    ("GET", "/api/dashboards", None, 11),
    ("GET", "/api/reports", None, 13),
    ("GET", "/api/saved-searches", None, 11),
    ("GET", "/api/report-documents", None, 12),
    ("GET", "/tags", None, 8),
    ("GET", "/admin/audit?page_size=50", None, 15),
    ("GET", "/admin/users?page_size=25", None, 13),
    ("GET", "/admin/logs?page_size=50", None, 13),
    ("GET", "/admin/jobs?page_size=25", None, 14),
    ("GET", "/admin/groups", None, 11),
    ("GET", "/admin/organizations", None, 17),
    ("GET", "/admin/roles", None, 9),
    ("GET", "/security/overview", None, 14),
    ("GET", "/security/sessions", None, 8),
]


def _fill(path: str, ids: dict[str, list[str]]) -> str | None:
    for key, values in ids.items():
        token = "{" + key + "}"
        if token in path:
            if not values:
                return None
            path = path.replace(token, values[0])
    return path


def _call(client, method: str, path: str, body, headers):
    return client.open(f"{PREFIX}{path}", method=method, headers=headers, json=body)


@pytest.mark.parametrize(("method", "path", "body", "budget"), BUDGETS,
                         ids=[f"{m} {p.split('?')[0]}{' ' + b['resource_type'] if b else ''}" for m, p, b, _ in BUDGETS])
def test_statement_budget(client, as_persona, count_queries, sample_ids, method, path, body, budget):
    headers = as_persona("admin")
    target = _fill(path, sample_ids)
    if target is None:
        pytest.skip("no seeded row to address")
    _call(client, method, target, body, headers)  # warm: first-use lookups do not count
    with count_queries() as queries:
        response = _call(client, method, target, body, headers)
    assert response.status_code == 200, response.get_data(as_text=True)[:300]
    if MEASURE:
        print(f"\nMEASURE {queries.count:4d}  {method} {path}")
    assert queries.count <= budget, (
        f"{method} {path} sent {queries.count} statements (budget {budget}):\n{queries.report()}"
    )


def test_auth_overhead_is_constant(client, as_persona, count_queries):
    """The fixed cost of being signed in: no handler queries, just the principal."""
    headers = as_persona("user")
    client.get(f"{PREFIX}/favorites", headers=headers)
    with count_queries() as queries:
        client.get(f"{PREFIX}/favorites", headers=headers)
    # favorites itself is one SELECT
    assert queries.count - 1 <= AUTH_FLOOR, queries.report()


def test_a_request_does_not_write_the_users_row(client, as_persona, count_queries):
    """`last_login_at` is written at most once a minute, not on every call.

    Every request of a person used to UPDATE their `users` row; with many
    requests in flight for one account they queued on that row's lock, which
    is what stalled the 1000-user load test.
    """
    headers = as_persona("analyst")
    client.get(f"{PREFIX}/favorites", headers=headers)
    with count_queries() as queries:
        for _ in range(3):
            client.get(f"{PREFIX}/favorites", headers=headers)
    writes = [s for s in queries.statements if s.startswith("UPDATE users ")]
    assert writes == [], queries.report()


#: List endpoints whose statement count must not depend on the page size.
FLAT = [
    ("POST", "/api/explorer/query", lambda n: {"resource_type": "task", "page_size": n}),
    ("POST", "/api/explorer/query", lambda n: {"resource_type": "order", "page_size": n, "facets": True}),
    ("POST", "/api/explorer/query", lambda n: {"resource_type": "customer", "page_size": n}),
    ("GET", "/notifications?page_size={n}", None),
    ("GET", "/api/activity?page_size={n}", None),
    ("GET", "/admin/audit?page_size={n}", None),
    ("GET", "/admin/users?page_size={n}", None),
    ("GET", "/admin/logs?page_size={n}", None),
    ("GET", "/admin/jobs?page_size={n}", None),
    ("GET", "/api/files?page_size={n}", None),
    ("GET", "/exports?page_size={n}", None),
    ("GET", "/api/mail/threads?page_size={n}", None),
    ("GET", "/security/sessions?page_size={n}", None),
    ("GET", "/imports?page_size={n}", None),
]


@pytest.mark.parametrize(("method", "path", "body"), FLAT,
                         ids=[f"{m} {p.split('?')[0]}{i}" for i, (m, p, _b) in enumerate(FLAT)])
def test_no_n_plus_one(client, as_persona, count_queries, method, path, body):
    headers = as_persona("admin")
    counts = {}
    for size in (2, 100):
        target = path.format(n=size)
        payload = body(size) if body else None
        _call(client, method, target, payload, headers)
        with count_queries() as queries:
            response = _call(client, method, target, payload, headers)
        assert response.status_code == 200, response.get_data(as_text=True)[:300]
        counts[size] = queries
    small, large = counts[2], counts[100]
    assert large.count <= small.count, (
        f"{method} {path}: {small.count} statements for 2 rows, {large.count} for 100 — a query per row\n"
        f"{large.report()}"
    )
