"""Data Explorer HTTP contract: auth, SQL queries and saved visibility. — endpoints require."""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from tests.explorer_support import (  # noqa: F401
    PREFIX,
    _authenticate,
    created_searches,
    preserved_defaults,
)


def test_explorer_endpoints_require_a_bearer_token(client):
    assert client.get(f"{PREFIX}/api/explorer/catalog").status_code == 401
    assert client.post(f"{PREFIX}/api/explorer/query", json={}).status_code == 401
    assert client.get(f"{PREFIX}/api/saved-searches").status_code == 401


@pytest.mark.database
def test_catalogue_is_live_and_drives_the_query_contract(client, monkeypatch):
    response = client.get(f"{PREFIX}/api/explorer/catalog", headers=_authenticate(monkeypatch))

    assert response.status_code == 200
    tasks = next(item for item in response.get_json()["items"] if item["key"] == "task")
    assert tasks["record_count"] > 0
    status = next(field for field in tasks["fields"] if field["name"] == "status")
    assert {"eq", "not_in", "empty"}.issubset(status["operators"])
    assert status["choices"]


@pytest.mark.database
def test_query_combines_simple_and_nested_conditions_in_sql(client, monkeypatch):
    from src.core.db import session_scope
    from src.models.business import Task

    with session_scope() as session:
        sample = session.scalars(select(Task).where(Task.deleted_at.is_(None)).limit(1)).one()

    response = client.post(
        f"{PREFIX}/api/explorer/query", headers=_authenticate(monkeypatch),
        json={
            "resource_type": "task", "query_text": sample.reference,
            "condition_tree": {
                "type": "group", "conjunction": "AND", "children1": {
                    "status": {"type": "rule", "properties": {
                        "field": "status", "operator": "select_equals", "value": [sample.status],
                    }},
                },
            },
            "columns": ["reference", "title", "status"], "page": 1, "page_size": 10,
        },
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["total"] == 1
    assert body["items"][0]["reference"] == sample.reference
    assert "Status =" in body["condition_text"]
    assert body["rule_count"] == 1


@pytest.mark.database
def test_query_rejects_unknown_resources_and_operators(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    unknown = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={"resource_type": "secrets"},
    )
    invalid = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={"resource_type": "task", "condition_tree": {
            "type": "rule", "properties": {
                "field": "progress", "operator": "contains", "value": ["5"],
            },
        }},
    )

    assert unknown.status_code == 400
    assert "task" in unknown.get_json()["details"]["available"]
    assert invalid.status_code == 400
    assert "cannot be applied" in invalid.get_json()["message"]


@pytest.mark.database
def test_explorer_checks_live_rbac_after_jwt_verification(client, monkeypatch):
    _authenticate(monkeypatch, "user", "viewer")
    monkeypatch.setattr("src.core.auth.users.permissions_for", lambda *_args: set())

    response = client.get(
        f"{PREFIX}/api/explorer/catalog",
        headers={"Authorization": "Bearer verified-but-unprivileged"},
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["records.view"]


@pytest.mark.database
def test_saved_search_lifecycle_preserves_question_and_presentation(client, monkeypatch, created_searches):
    headers = _authenticate(monkeypatch)
    name = f"Explorer test {uuid4()}"
    payload = {
        "name": name, "resource_type": "task", "scope": "PRIVATE",
        "query_text": "review", "condition_tree": {
            "type": "group", "conjunction": "AND", "children1": {
                "priority": {"type": "rule", "properties": {
                    "field": "priority", "operator": "select_any_in", "value": [["HIGH", "CRITICAL"]],
                }},
            },
        },
        "sort": "due_date", "order": "asc",
        "columns": ["reference", "title", "priority", "due_date"],
        "page_size": 50, "view_mode": "table",
    }
    created = client.post(f"{PREFIX}/api/saved-searches", headers=headers, json=payload)
    assert created.status_code == 201
    search = created.get_json()
    # Registered even though the test deletes them: `DELETE` is a soft delete,
    # and a soft-deleted row is still a row in the demo database.
    created_searches.append(search["id"])
    assert search["condition_text"].strip() == "Priority in ['HIGH', 'CRITICAL']"
    assert search["can_edit"] is True

    listed = client.get(
        f"{PREFIX}/api/saved-searches?resource_type=task", headers=headers,
    ).get_json()["items"]
    assert search["id"] in {item["id"] for item in listed}

    updated = client.put(
        f"{PREFIX}/api/saved-searches/{search['id']}", headers=headers,
        json={"name": f"{name} renamed", "is_favorite": True},
    )
    assert updated.status_code == 200
    assert updated.get_json()["is_favorite"] is True

    copied = client.post(
        f"{PREFIX}/api/saved-searches/{search['id']}/duplicate", headers=headers,
    )
    created_searches.append(copied.get_json()["id"])
    assert copied.status_code == 201
    assert copied.get_json()["scope"] == "PRIVATE"
    assert copied.get_json()["owner"]["id"] == search["owner"]["id"]

    # The suite runs against the same database the application uses, so what it
    # creates it also removes — a demo dataset silting up with "Explorer test
    # … (copy)" is a demo nobody wants to show anybody.
    assert client.delete(
        f"{PREFIX}/api/saved-searches/{copied.get_json()['id']}", headers=headers
    ).status_code == 204
    assert client.delete(f"{PREFIX}/api/saved-searches/{search['id']}", headers=headers).status_code == 204
    assert client.get(f"{PREFIX}/api/saved-searches/{search['id']}", headers=headers).status_code == 404


@pytest.mark.database
def test_marking_a_second_search_as_default_demotes_the_first(
    client, monkeypatch, created_searches, preserved_defaults
):
    """One answer to "what should this list open with", per person per dataset.

    A second default is not refused: somebody marking one has changed their
    mind, and an error asking them to go and unmark the old one first is a
    chore with no decision in it (§46).
    """
    headers = _authenticate(monkeypatch)
    base = {
        "resource_type": "task", "scope": "PRIVATE", "sort": "due_date",
        "order": "asc", "columns": ["reference", "title"], "page_size": 25,
        "view_mode": "table", "is_default": True,
    }

    first = client.post(
        f"{PREFIX}/api/saved-searches", headers=headers,
        json={**base, "name": f"Explorer default A {uuid4()}"},
    )
    assert first.status_code == 201
    created_searches.append(first.get_json()["id"])
    assert first.get_json()["is_default"] is True

    second = client.post(
        f"{PREFIX}/api/saved-searches", headers=headers,
        json={**base, "name": f"Explorer default B {uuid4()}"},
    )
    created_searches.append(second.get_json()["id"])

    listed = {
        item["id"]: item
        for item in client.get(
            f"{PREFIX}/api/saved-searches?resource_type=task", headers=headers
        ).get_json()["items"]
    }
    assert listed[second.get_json()["id"]]["is_default"] is True
    assert listed[first.get_json()["id"]]["is_default"] is False
    # Exactly one, which is the property a list can rely on when it decides
    # what to open with.
    mine = [
        item for item in listed.values()
        if item["is_default"] and item["can_edit"]
    ]
    assert len(mine) == 1

    # A default of another dataset is a different question, so it stands.
    other = client.post(
        f"{PREFIX}/api/saved-searches", headers=headers,
        json={
            **base, "name": f"Explorer default C {uuid4()}",
            "resource_type": "ticket", "sort": "created_at",
            "columns": ["reference", "subject"],
        },
    )
    created_searches.append(other.get_json()["id"])
    assert other.get_json()["is_default"] is True
    still = client.get(
        f"{PREFIX}/api/saved-searches/{second.get_json()['id']}", headers=headers
    ).get_json()
    assert still["is_default"] is True

    # And promoting through an update demotes the same way a creation does.
    promoted = client.put(
        f"{PREFIX}/api/saved-searches/{first.get_json()['id']}", headers=headers,
        json={"is_default": True},
    )
    assert promoted.status_code == 200
    assert promoted.get_json()["is_default"] is True
    demoted = client.get(
        f"{PREFIX}/api/saved-searches/{second.get_json()['id']}", headers=headers
    ).get_json()
    assert demoted["is_default"] is False

    # Somebody else's default is somebody else's: the demotion is scoped to the
    # owner, and getting that clause wrong would quietly change what every
    # colleague's list opens with.
    viewer_headers = _authenticate(monkeypatch, "user", "viewer")
    theirs = client.post(
        f"{PREFIX}/api/saved-searches", headers=viewer_headers,
        json={**base, "name": f"Viewer default {uuid4()}"},
    )
    created_searches.append(theirs.get_json()["id"])
    assert theirs.get_json()["is_default"] is True

    _authenticate(monkeypatch)
    client.put(
        f"{PREFIX}/api/saved-searches/{second.get_json()['id']}", headers=headers,
        json={"is_default": True},
    )
    _authenticate(monkeypatch, "user", "viewer")
    assert client.get(
        f"{PREFIX}/api/saved-searches/{theirs.get_json()['id']}", headers=viewer_headers
    ).get_json()["is_default"] is True


@pytest.mark.database
def test_the_repair_makes_saved_searches_usable_on_a_list(created_searches):
    """`--sync-searches`, on the two things it fixes (§46).

    A filter key no dataset declares narrows nothing — `apply_filters` iterates
    the *declared* fields — so the row looked correct until the entity lists
    could apply one, at which point it put `f.q=overdue` in the address and
    counted as a filter. And a database whose saved searches all carry
    condition trees has a views menu that can only link to the Data Explorer,
    because a tree is not expressible as facet selects.

    Written through the session rather than the API, because the API would
    reject the unusable key: the rows this repairs were written by the
    generator, which does not go through it.
    """
    from src.core.db import session_scope
    from src.models.identity import User
    from src.models.personal import SavedSearch
    from src.seed import catalog, runner

    with session_scope() as session:
        owner = session.scalars(
            select(User).where(User.email == "admin@nucleus.example")
        ).one()
        row = SavedSearch(
            name=f"Explorer repair {uuid4()}", resource_type="task",
            owner_id=owner.id, organization_id=owner.organization_id, scope="PRIVATE",
            filters={"q": "overdue", "priority": "HIGH"},
            sort="due_date", order="asc", columns=["reference", "title"],
            page_size=25, view_mode="table",
        )
        session.add(row)
        session.flush()
        created_searches.append(str(row.id))
        identifier = row.id

    with session_scope() as session:
        first = runner.sync_searches(session)
    with session_scope() as session:
        again = runner.sync_searches(session)
        repaired = session.get(SavedSearch, identifier)
        assert repaired is not None
        # The key that cannot work is gone; the one that can is untouched.
        assert repaired.filters == {"priority": "HIGH"}

        # And every dataset now has a view a list can show.
        for name, resource_type, field, value in catalog.LIST_VIEWS:
            view = session.scalars(
                select(SavedSearch).where(
                    SavedSearch.name == name, SavedSearch.deleted_at.is_(None)
                )
            ).unique().one()
            assert view.resource_type == resource_type
            assert view.filters == {field: value}
            # No tree, which is what makes it applicable to a list at all.
            assert view.condition_tree is None
            assert view.rule_count == 0
            assert view.scope == "PUBLIC"

    assert first["cleaned"] >= 1
    # Additive and idempotent: the second pass finds nothing left to do.
    assert again == {"cleaned": 0, "added": 0}


@pytest.mark.database
def test_shared_search_is_readable_but_only_owner_can_mutate(client, monkeypatch, created_searches):
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        member = session.scalars(select(User).where(User.email == "user@nucleus.example")).one()

    owner_headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=owner_headers,
        json={
            "name": f"Shared explorer {uuid4()}", "resource_type": "task", "scope": "SHARED",
            "member_ids": [str(member.id)], "columns": ["reference", "title"],
            "sort": "updated_at", "order": "desc", "page_size": 25, "view_mode": "list",
        },
    ).get_json()
    created_searches.append(created["id"])

    member_headers = _authenticate(monkeypatch, "user", "viewer")
    opened = client.get(f"{PREFIX}/api/saved-searches/{created['id']}", headers=member_headers)
    denied = client.put(
        f"{PREFIX}/api/saved-searches/{created['id']}", headers=member_headers,
        json={"name": "Taken over"},
    )

    assert opened.status_code == 200
    assert opened.get_json()["can_edit"] is False
    assert denied.status_code == 403
    assert "Only the owner" in denied.get_json()["message"]
