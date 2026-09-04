"""Audit explorer HTTP contract (§21).

The ledger is the one screen whose value is entirely in being trustworthy, so
what is asserted here is less "does it return rows" than: does it filter in
SQL, does it distinguish a field that was added from one that was cleared, does
it keep secrets out of the diff, does it stay readable when the actor is gone,
and is it genuinely read-only.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return {
        "sub": "", "email": f"{username}@nucleus.example",
        "preferred_username": username, "name": username.title(),
        "sid": f"audit-{username}", "realm_access": {"roles": [role]},
    }


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer audit-{username}"}


@pytest.fixture()
def planted(has_database):
    """Audit rows a test writes, removed however the test ends."""
    identifiers: list = []
    yield identifiers

    if not has_database or not identifiers:
        return
    from sqlalchemy import delete as sql_delete

    from src.core.db import session_scope
    from src.models.platform import AuditLog

    with session_scope() as session:
        session.execute(sql_delete(AuditLog).where(AuditLog.id.in_(identifiers)))


def _plant(planted: list, **overrides):
    """One audit row, written the way `core/audit.record` writes them."""
    from src.core.audit import diff
    from src.core.clock import now
    from src.core.db import session_scope
    from src.models.platform import AuditLog

    before = overrides.pop("before", None)
    after = overrides.pop("after", None)
    changes = diff(before, after)

    with session_scope() as session:
        row = AuditLog(
            id=uuid4(),
            occurred_at=overrides.pop("occurred_at", now()),
            action=overrides.pop("action", "UPDATE"),
            resource_type=overrides.pop("resource_type", "audit_test"),
            resource_id=overrides.pop("resource_id", str(uuid4())),
            resource_label=overrides.pop("resource_label", "audit-test row"),
            actor_label=overrides.pop("actor_label", "Audit Test"),
            actor_role=overrides.pop("actor_role", "ADMINISTRATOR"),
            result=overrides.pop("result", "SUCCESS"),
            correlation_id=overrides.pop("correlation_id", uuid4().hex),
            state_before=before,
            state_after=after,
            changed_fields=list(changes) or None,
            changes=changes or None,
            **overrides,
        )
        session.add(row)
        session.flush()
        identifier = row.id
    planted.append(identifier)
    return identifier


def test_the_ledger_requires_a_bearer_token(client):
    assert client.get(f"{PREFIX}/admin/audit").status_code == 401
    assert client.get(f"{PREFIX}/admin/audit/catalog").status_code == 401
    assert client.get(f"{PREFIX}/admin/audit/{uuid4()}").status_code == 401
    assert client.get(f"{PREFIX}/api/audit/timeline").status_code == 401


@pytest.mark.database
def test_a_role_without_audit_view_is_refused_and_told_which_permission(client, monkeypatch):
    # OPERATOR reads records but not the ledger, which is the distinction the
    # whole screen depends on.
    headers = _authenticate(monkeypatch, "operator", "operator")

    response = client.get(f"{PREFIX}/admin/audit", headers=headers)

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["audit.view"]


@pytest.mark.database
def test_the_catalogue_publishes_the_vocabulary_the_filters_are_built_from(client, monkeypatch):
    body = client.get(
        f"{PREFIX}/admin/audit/catalog", headers=_authenticate(monkeypatch)
    ).get_json()

    names = {field["name"] for field in body["fields"]}
    assert {"action", "actor_label", "resource_type", "result", "correlation_id"} <= names
    assert "CREATE" in body["actions"]
    assert "DENIED" in body["results"]
    assert body["total"] > 0

    # The builder can never offer an operator the backend would reject,
    # because both read this one declaration.
    action = next(field for field in body["fields"] if field["name"] == "action")
    assert set(action["operators"]) >= {"eq", "in", "not_in"}
    assert "contains" not in action["operators"]


@pytest.mark.database
def test_the_ledger_pages_and_facets_in_sql(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    body = client.get(f"{PREFIX}/admin/audit?page_size=10", headers=headers).get_json()

    assert len(body["items"]) == 10
    assert body["total"] > 10
    assert body["page_size"] == 10
    # Facets are computed over the whole filtered result, not the ten rows.
    assert sum(entry["count"] for entry in body["facets"]["action"]) > 10
    assert body["items"][0]["occurred_at"] >= body["items"][-1]["occurred_at"]


@pytest.mark.database
def test_filters_narrow_the_ledger_rather_than_the_page(client, monkeypatch, planted):
    _plant(planted, action="EXPORT", result="DENIED", actor_label="Audit Test Denied")
    headers = _authenticate(monkeypatch)

    denied = client.get(
        f"{PREFIX}/admin/audit?action=EXPORT&result=DENIED&page_size=100", headers=headers
    ).get_json()

    assert denied["total"] >= 1
    assert {item["action"] for item in denied["items"]} == {"EXPORT"}
    assert {item["result"] for item in denied["items"]} == {"DENIED"}


@pytest.mark.database
def test_an_investigation_starts_from_a_correlation_id(client, monkeypatch, planted):
    # The id on a failed request's error message has to lead somewhere, or it
    # is decoration.
    correlation = uuid4().hex
    _plant(planted, correlation_id=correlation)
    headers = _authenticate(monkeypatch)

    found = client.get(
        f"{PREFIX}/admin/audit?correlation_id={correlation}", headers=headers
    ).get_json()

    assert found["total"] == 1
    assert found["items"][0]["correlation_id"] == correlation


@pytest.mark.database
def test_an_entry_distinguishes_added_changed_and_cleared_fields(client, monkeypatch, planted):
    identifier = _plant(
        planted,
        before={"status": "OPEN", "assignee": "Ana Pop", "note": None},
        after={"status": "CLOSED", "assignee": None, "note": "resolved on call"},
    )
    headers = _authenticate(monkeypatch)

    body = client.get(f"{PREFIX}/admin/audit/{identifier}", headers=headers).get_json()

    kinds = {change["field"]: change["kind"] for change in body["changes"]}
    assert kinds == {"status": "changed", "assignee": "cleared", "note": "added"}
    status = next(change for change in body["changes"] if change["field"] == "status")
    assert (status["from"], status["to"]) == ("OPEN", "CLOSED")
    assert body["changed_fields"] == ["assignee", "note", "status"]


@pytest.mark.database
def test_a_secret_never_reaches_the_diff(client, monkeypatch, planted):
    # §76. This plants the row directly, *without* going through
    # `core/audit.record`, so the raw values really are in the table — which
    # is the only way to assert that the endpoint itself redacts rather than
    # relying on every writer, present and future, to have done it.
    identifier = _plant(
        planted,
        before={"api_key": "live_sk_before", "label": "Billing"},
        after={"api_key": "live_sk_after", "label": "Billing EU"},
    )
    headers = _authenticate(monkeypatch)

    body = client.get(f"{PREFIX}/admin/audit/{identifier}", headers=headers).get_json()

    rendered = str(body)
    assert "live_sk_before" not in rendered
    assert "live_sk_after" not in rendered
    assert body["state_after"]["label"] == "Billing EU"


@pytest.mark.database
def test_an_impersonated_action_records_both_identities(client, monkeypatch, planted):
    identifier = _plant(
        planted,
        action="IMPERSONATE",
        actor_label="Uma User",
        impersonated=True,
        impersonator_label="Ada Administrator",
    )
    headers = _authenticate(monkeypatch)

    body = client.get(f"{PREFIX}/admin/audit/{identifier}", headers=headers).get_json()

    # Who the request was treated as, and who was actually at the keyboard.
    assert body["actor_label"] == "Uma User"
    assert body["impersonated"] is True
    assert body["impersonator_label"] == "Ada Administrator"


@pytest.mark.database
def test_an_entry_stays_readable_when_its_actor_is_gone(client, monkeypatch, planted):
    # `actor_label` is denormalised precisely so this holds: the row has no
    # actor_id at all and still names who acted.
    identifier = _plant(planted, actor_label="Departed Colleague", actor_id=None)
    headers = _authenticate(monkeypatch)

    body = client.get(f"{PREFIX}/admin/audit/{identifier}", headers=headers).get_json()

    assert body["actor_label"] == "Departed Colleague"
    assert body["actor_id"] is None


@pytest.mark.database
def test_a_missing_entry_is_a_404_and_a_bad_page_size_is_a_400(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    assert client.get(f"{PREFIX}/admin/audit/{uuid4()}", headers=headers).status_code == 404
    assert client.get(f"{PREFIX}/admin/audit?page_size=9999", headers=headers).status_code == 400


@pytest.mark.database
def test_the_ledger_is_read_only(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    identifier = uuid4()

    # No writer is mounted, so none of these can reach a handler. An audit
    # trail with a DELETE is a trail whose missing entry proves nothing.
    for call in (
        client.post(f"{PREFIX}/admin/audit", headers=headers, json={}),
        client.put(f"{PREFIX}/admin/audit/{identifier}", headers=headers, json={}),
        client.delete(f"{PREFIX}/admin/audit/{identifier}", headers=headers),
    ):
        assert call.status_code in (404, 405)


@pytest.mark.database
def test_a_timeline_is_scoped_to_one_record_and_refuses_to_be_the_ledger(
    client, monkeypatch, planted
):
    resource_id = str(uuid4())
    for _ in range(3):
        _plant(planted, resource_type="audit_test_entity", resource_id=resource_id)
    _plant(planted, resource_type="audit_test_entity", resource_id=str(uuid4()))
    headers = _authenticate(monkeypatch)

    scoped = client.get(
        f"{PREFIX}/api/audit/timeline?resource_type=audit_test_entity&resource_id={resource_id}",
        headers=headers,
    )
    unscoped = client.get(f"{PREFIX}/api/audit/timeline", headers=headers)

    assert scoped.status_code == 200
    assert scoped.get_json()["total"] == 3
    assert {item["resource_id"] for item in scoped.get_json()["items"]} == {resource_id}
    # Without a resource this would be the whole ledger behind records.view.
    assert unscoped.status_code == 400


@pytest.mark.database
def test_a_timeline_needs_only_the_permission_to_read_the_record(client, monkeypatch, planted):
    resource_id = str(uuid4())
    _plant(planted, resource_type="audit_test_entity", resource_id=resource_id)
    # VIEWER holds records.view and not audit.view.
    headers = _authenticate(monkeypatch, "user", "viewer")

    timeline = client.get(
        f"{PREFIX}/api/audit/timeline?resource_type=audit_test_entity&resource_id={resource_id}",
        headers=headers,
    )
    ledger = client.get(f"{PREFIX}/admin/audit", headers=headers)

    assert timeline.status_code == 200
    assert timeline.get_json()["total"] == 1
    assert ledger.status_code == 403


@pytest.mark.database
def test_a_timeline_limit_is_bounded(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    query = "resource_type=task&resource_id=" + str(uuid4())

    assert client.get(
        f"{PREFIX}/api/audit/timeline?{query}&limit=0", headers=headers
    ).status_code == 400
    assert client.get(
        f"{PREFIX}/api/audit/timeline?{query}&limit=5000", headers=headers
    ).status_code == 400
