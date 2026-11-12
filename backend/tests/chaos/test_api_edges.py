"""Edge cases and a security quick-pass on the API (docs/testing/security-edge-cases.md).

Abusive and odd input must be a 4xx with the normal envelope, never a 500 and
never a slow query: page sizes, rule trees nested or wide past the limits,
fields and operators that do not exist, SQL-ish and NUL-laden strings,
unicode, oversized uploads. Then the cross-persona checks (IDOR): a person
reaching for somebody else's private things by id gets a 404 or 403, never the
thing. Then concurrent edits under optimistic locking.

Three of these found real bugs, fixed alongside:

* a NUL byte in a search term reached PostgreSQL and came back as a 500;
* a comment on a record that does not exist was stored (201);
* two saves of the same version could both succeed — the version check
  allowed a whole second of slack and did not lock the row.
"""

from __future__ import annotations

import threading

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
ROLES = {"admin": "administrator", "manager": "manager", "user": "user", "analyst": "analyst"}

pytestmark = pytest.mark.database


@pytest.fixture()
def as_persona(monkeypatch):
    def _sign_in(name: str) -> dict[str, str]:
        claims = persona_claims(name, ROLES[name], sid=f"edge-{name}")
        monkeypatch.setattr("src.core.auth.verify_token", lambda _t: claims)
        return {"Authorization": f"Bearer edge-{name}"}

    return _sign_in


def _deep(levels: int) -> dict:
    node = {"type": "rule", "properties": {"field": "status", "operator": "equal", "value": ["OPEN"]}}
    for _ in range(levels):
        node = {"type": "group", "properties": {"conjunction": "AND"}, "children1": [node]}
    return node


def _rule(field: str, operator: str, value) -> dict:
    return {"type": "group", "children1": [
        {"type": "rule", "properties": {"field": field, "operator": operator, "value": value}}]}


def _ok_or_client_error(response, expected=(200, 400)):
    assert response.status_code in expected, (response.status_code, response.get_data(as_text=True)[:300])
    if response.status_code >= 400:
        body = response.get_json()
        assert body and body.get("error"), "a 4xx carries the error envelope"


# ── pagination ────────────────────────────────────────────────────────────


@pytest.mark.parametrize("query", ["page_size=0", "page_size=-1", "page_size=201", "page_size=100000",
                                   "page=abc", "page=1e9", "order=sideways"])
@pytest.mark.parametrize("path", ["/admin/audit", "/notifications", "/api/files", "/exports", "/admin/users"])
def test_bad_paging_is_a_400(client, as_persona, path, query):
    response = client.get(f"{PREFIX}{path}?{query}", headers=as_persona("admin"))
    assert response.status_code == 400, response.get_data(as_text=True)[:200]
    assert response.get_json()["error"] == "validation_error"


@pytest.mark.parametrize("query", ["page=-5", "page=999999999999", "sort=nonexistent", "sort=id;drop%20table%20x"])
def test_odd_but_harmless_paging_answers(client, as_persona, query):
    response = client.get(f"{PREFIX}/admin/audit?{query}", headers=as_persona("admin"))
    assert response.status_code == 200


def test_a_page_far_past_the_end_is_empty_not_slow(client, as_persona):
    response = client.post(f"{PREFIX}/api/explorer/query", headers=as_persona("admin"),
                           json={"resource_type": "ticket", "page": 10**15})
    assert response.status_code in (200, 400)
    if response.status_code == 200:
        assert response.get_json()["items"] == []


# ── rule trees and filters ────────────────────────────────────────────────


@pytest.mark.parametrize(("body", "expected"), [
    ({"condition_tree": _deep(11)}, 200),
    ({"condition_tree": _deep(13)}, 400),
    ({"condition_tree": _deep(900)}, 400),
    ({"condition_tree": {"type": "group", "children1": "oops"}}, 400),
    ({"condition_tree": _rule("nope", "equal", [1])}, 400),
    ({"condition_tree": _rule("status", "bogus", [1])}, 400),
    ({"condition_tree": _rule("created_at", "greater", ["not-a-date"])}, 400),
    ({"condition_tree": {"type": "group", "children1": [_rule("status", "equal", ["x"])["children1"][0]] * 500}}, 400),
    ({"filters": {"status": "OPEN' OR 1=1--"}}, 200),
    ({"filters": {"status": {"$ne": 1}}}, 200),
    ({"filters": {"nope": ["x"]}}, 200),
    ({"columns": ["id", "password"]}, 400),
    ({"query_text": "'; DROP TABLE users;--"}, 200),
    ({"query_text": "%_%\\"}, 200),
    ({"query_text": "مرحبا 👩‍💻 ünïcödé 批量"}, 200),
    ({"query_text": "x" * 20000}, 400),
    ({"query_text": "a\u0000b"}, 400),
    ({"page_size": 100000}, 400),
    ({"sort": "nope"}, 200),
])
def test_explorer_refuses_or_survives_abuse(client, as_persona, body, expected):
    response = client.post(f"{PREFIX}/api/explorer/query", headers=as_persona("admin"),
                           json={"resource_type": "ticket", **body})
    assert response.status_code == expected, response.get_data(as_text=True)[:300]
    _ok_or_client_error(response)


def test_numbers_past_range_are_refused_not_a_500(client, as_persona):
    response = client.post(f"{PREFIX}/api/explorer/query", headers=as_persona("admin"),
                           json={"resource_type": "order", "condition_tree": _rule("total", "greater", [10 ** 400])})
    _ok_or_client_error(response)


@pytest.mark.parametrize("raw", ["[1,2,3]", '"just a string"', "not json", "{" * 5000])
def test_non_object_bodies_are_a_400(client, as_persona, raw):
    headers = {**as_persona("admin"), "Content-Type": "application/json"}
    response = client.post(f"{PREFIX}/api/explorer/query", headers=headers, data=raw)
    assert response.status_code == 400


@pytest.mark.parametrize("q", ["%%%", "\u0000", "'; select pg_sleep(5);--", "👩‍💻", "_"])
def test_global_search_takes_anything(client, as_persona, q):
    response = client.get(f"{PREFIX}/api/search/global", query_string={"q": q}, headers=as_persona("user"))
    _ok_or_client_error(response)


# ── uploads and record ids ────────────────────────────────────────────────


@pytest.mark.parametrize(("payload", "status"), [
    ({"name": "big.bin", "size_bytes": 10 ** 12, "mime_type": "application/octet-stream"}, 400),
    ({"name": "x.exe", "size_bytes": 10}, 400),
    ({"name": "", "size_bytes": 10}, 400),
    ({"name": "a.txt", "size_bytes": -1}, 400),
])
def test_upload_tickets_refuse_bad_files(client, as_persona, payload, status):
    response = client.post(f"{PREFIX}/api/files", headers=as_persona("admin"), json=payload)
    assert response.status_code == status, response.get_data(as_text=True)[:200]


@pytest.mark.parametrize("path", ["/api/records/ticket/not-a-uuid", "/api/records/ticket/00000000-0000-0000-0000-000000000000",
                                  "/api/records/nope/00000000-0000-0000-0000-000000000000"])
def test_bad_record_addresses_are_4xx(client, as_persona, path):
    response = client.get(f"{PREFIX}{path}", headers=as_persona("admin"))
    assert 400 <= response.status_code < 500


def test_a_comment_needs_a_record_that_exists(client, as_persona):
    response = client.post(f"{PREFIX}/api/comments", headers=as_persona("admin"), json={
        "resource_type": "ticket", "resource_id": "00000000-0000-0000-0000-000000000000", "body": "orphan"})
    assert response.status_code == 404, response.get_data(as_text=True)[:200]


def test_unicode_round_trips(client, as_persona):
    name = "Edge ✓ مرحبا 👩‍💻 批量 — ünïcödé"
    headers = as_persona("admin")
    made = client.post(f"{PREFIX}/api/kanban/boards", headers=headers, json={"name": name})
    assert made.status_code == 201
    board = made.get_json()
    try:
        assert client.get(f"{PREFIX}/api/kanban/boards/{board['id']}", headers=headers).get_json()["board"]["name"] == name
    finally:
        client.delete(f"{PREFIX}/api/kanban/boards/{board['id']}", headers=headers)


# ── permissions across personas (IDOR) ────────────────────────────────────


def test_private_things_stay_private_across_personas(client, as_persona):
    admin = as_persona("admin")
    board = client.post(f"{PREFIX}/api/kanban/boards", headers=admin, json={"name": "Edge private board"}).get_json()
    dashboard = client.post(f"{PREFIX}/api/dashboards", headers=admin, json={"name": "Edge private dashboard"})
    assert dashboard.status_code in (200, 201), dashboard.get_data(as_text=True)[:200]
    dashboard = dashboard.get_json()
    try:
        user = as_persona("user")
        for method, path, body in [
            ("GET", f"/api/kanban/boards/{board['id']}", None),
            ("PUT", f"/api/kanban/boards/{board['id']}", {"name": "pwned"}),
            ("DELETE", f"/api/kanban/boards/{board['id']}", None),
            ("GET", f"/api/dashboards/{dashboard['id']}", None),
            ("PUT", f"/api/dashboards/{dashboard['id']}", {"name": "pwned"}),
            ("DELETE", f"/api/dashboards/{dashboard['id']}", None),
        ]:
            response = client.open(f"{PREFIX}{path}", method=method, headers=user, json=body)
            assert response.status_code in (403, 404), (method, path, response.status_code)
        admin = as_persona("admin")
        assert client.get(f"{PREFIX}/api/kanban/boards/{board['id']}", headers=admin).get_json()["board"]["name"] \
            == "Edge private board"
    finally:
        admin = as_persona("admin")
        client.delete(f"{PREFIX}/api/kanban/boards/{board['id']}", headers=admin)
        client.delete(f"{PREFIX}/api/dashboards/{dashboard['id']}", headers=admin)


@pytest.mark.parametrize(("method", "path", "body"), [
    ("GET", "/admin/audit", None), ("GET", "/admin/logs", None), ("POST", "/admin/roles", {"code": "X", "name": "x"}),
    ("PUT", "/admin/settings/retention.log_days", {"value": 1}), ("POST", "/admin/logs/prune", {}),
])
def test_admin_surfaces_refuse_a_viewer(client, as_persona, method, path, body):
    response = client.open(f"{PREFIX}{path}", method=method, headers=as_persona("user"), json=body)
    assert response.status_code == 403


def test_impersonation_header_is_ignored_for_a_non_admin(client, as_persona):
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        admin_id = str(session.query(User.id).filter(User.username == "admin").scalar())
    headers = {**as_persona("user"), "X-Impersonate-User": admin_id}
    me = client.get(f"{PREFIX}/api/me", headers=headers).get_json()
    assert "admin" not in str(me.get("username") or me.get("user", {}).get("username") or "")


# ── concurrent edits ──────────────────────────────────────────────────────


@pytest.fixture()
def task(client, as_persona):
    headers = as_persona("admin")
    response = client.post(f"{PREFIX}/api/records/task", headers=headers, json={"title": "Edge concurrency task"})
    assert response.status_code == 201, response.get_data(as_text=True)[:300]
    return response.get_json()


def test_a_second_save_of_the_same_version_is_a_409(client, as_persona, task):
    headers = as_persona("admin")
    seen = task.get("updated_at") or task.get("record", {}).get("updated_at")
    url = f"{PREFIX}/api/records/task/{task['id']}"
    first = client.put(url, headers=headers, json={"title": "first", "expected_updated_at": seen})
    assert first.status_code == 200
    second = client.put(url, headers=headers, json={"title": "second", "expected_updated_at": seen})
    assert second.status_code == 409, "the second editor overwrote the first"
    assert second.get_json()["error"] == "conflict"


def test_simultaneous_saves_of_one_version_let_exactly_one_through(app, as_persona, task):
    headers = as_persona("admin")
    seen = task.get("updated_at") or task.get("record", {}).get("updated_at")
    url = f"{PREFIX}/api/records/task/{task['id']}"
    statuses: list[int] = []
    gate = threading.Barrier(4)

    def save(n: int):
        local = app.test_client()
        gate.wait()
        statuses.append(local.put(url, headers=headers, json={"title": f"racer {n}", "expected_updated_at": seen}).status_code)

    threads = [threading.Thread(target=save, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(30)
    assert sorted(statuses) == [200, 409, 409, 409], statuses
