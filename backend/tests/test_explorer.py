"""Data Explorer HTTP contract: auth, SQL queries and saved visibility."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from src.config import Config

PREFIX = Config.API_PREFIX


def _claims(username: str, role: str) -> dict:
    return {
        "sub": "", "email": f"{username}@nucleus.example",
        "preferred_username": username, "name": username.title(),
        "sid": f"explorer-{username}", "realm_access": {"roles": [role]},
    }


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: _claims(username, role))
    return {"Authorization": f"Bearer explorer-{username}"}


@pytest.fixture()
def created_searches(has_database):
    """Saved searches a test creates, removed however the test ends.

    This suite runs against the same PostgreSQL the application serves, so a
    test that leaves rows behind changes what the next person to open the demo
    sees — and "Explorer test 8f3c… (copy)" in a saved-search panel is not a
    demo anybody wants to show. Removed through the session rather than the API
    because ownership may have moved during the test.
    """
    identifiers: list[str] = []
    yield identifiers

    if not has_database or not identifiers:
        return
    from sqlalchemy import delete as sql_delete

    from src.core.db import session_scope
    from src.models.personal import ResourceShare, SavedSearch

    with session_scope() as session:
        session.execute(sql_delete(ResourceShare).where(
            ResourceShare.resource_type == "saved_search",
            ResourceShare.resource_id.in_(identifiers),
        ))
        session.execute(sql_delete(SavedSearch).where(
            SavedSearch.id.in_([UUID(value) for value in identifiers])
        ))


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
    monkeypatch.setattr("src.core.auth._permissions_for", lambda *_args: set())

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


@pytest.mark.database
def test_private_search_is_not_discoverable_by_another_user(client, monkeypatch, created_searches):
    owner_headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=owner_headers,
        json={
            "name": f"Private explorer {uuid4()}", "resource_type": "task",
            "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
            "page_size": 25, "view_mode": "table",
        },
    ).get_json()
    created_searches.append(created["id"])

    other_headers = _authenticate(monkeypatch, "user", "viewer")
    listed = client.get(
        f"{PREFIX}/api/saved-searches?resource_type=task", headers=other_headers,
    ).get_json()["items"]
    direct = client.get(f"{PREFIX}/api/saved-searches/{created['id']}", headers=other_headers)

    assert created["id"] not in {item["id"] for item in listed}
    assert direct.status_code == 404


@pytest.mark.database
def test_sharing_needs_the_share_permission(client, monkeypatch, created_searches):
    """A viewer keeps their own searches and publishes none of anyone's."""
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        colleague = session.scalars(
            select(User).where(User.email == "manager@nucleus.example")
        ).one()

    viewer_headers = _authenticate(monkeypatch, "user", "viewer")
    private = {
        "name": f"Viewer private {uuid4()}", "resource_type": "task",
        "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
        "page_size": 25, "view_mode": "table",
    }
    own = client.post(f"{PREFIX}/api/saved-searches", headers=viewer_headers, json=private)
    published = client.post(
        f"{PREFIX}/api/saved-searches", headers=viewer_headers,
        json={**private, "name": f"Viewer public {uuid4()}", "scope": "PUBLIC"},
    )
    shared = client.post(
        f"{PREFIX}/api/saved-searches", headers=viewer_headers,
        json={**private, "name": f"Viewer shared {uuid4()}", "member_ids": [str(colleague.id)]},
    )

    created_searches.append(own.get_json()["id"])
    assert own.status_code == 201
    assert published.status_code == 403
    assert shared.status_code == 403
    assert "searches.share" in str(published.get_json()["details"])


@pytest.mark.database
def test_ownership_transfer_is_explicit_and_leaves_the_previous_owner_reading(client, monkeypatch, created_searches):
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        recipient = session.scalars(
            select(User).where(User.email == "manager@nucleus.example")
        ).one()
        recipient_id, recipient_name = str(recipient.id), recipient.full_name

    owner_headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=owner_headers,
        json={
            "name": f"Handover {uuid4()}", "resource_type": "task", "scope": "SHARED",
            "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
            "page_size": 25, "view_mode": "table",
        },
    ).get_json()
    created_searches.append(created["id"])

    handed = client.post(
        f"{PREFIX}/api/saved-searches/{created['id']}/transfer", headers=owner_headers,
        json={"owner_id": recipient_id},
    )

    assert handed.status_code == 200
    body = handed.get_json()
    assert body["owner"]["id"] == recipient_id
    assert body["owner"]["name"] == recipient_name
    # The previous owner is now a member: still reading, no longer deciding.
    assert created["owner"]["id"] in {member["id"] for member in body["members"]}

    after = client.get(f"{PREFIX}/api/saved-searches/{created['id']}", headers=owner_headers)
    assert after.status_code == 200
    assert after.get_json()["can_edit"] is False
    assert client.put(
        f"{PREFIX}/api/saved-searches/{created['id']}", headers=owner_headers,
        json={"name": "Mine again"},
    ).status_code == 403

    # The handover itself is on the audit trail (§21).
    with session_scope() as session:
        from src.models.platform import AuditLog

        actions = session.scalars(
            select(AuditLog.action).where(AuditLog.resource_id == created["id"])
        ).all()
    assert "TRANSFER" in actions


@pytest.mark.database
def test_transfer_refuses_a_recipient_who_cannot_receive(client, monkeypatch, created_searches):
    headers = _authenticate(monkeypatch)
    created = client.post(
        f"{PREFIX}/api/saved-searches", headers=headers,
        json={
            "name": f"Nowhere {uuid4()}", "resource_type": "task",
            "columns": ["reference", "title"], "sort": "updated_at", "order": "desc",
            "page_size": 25, "view_mode": "table",
        },
    ).get_json()
    created_searches.append(created["id"])

    nobody = client.post(
        f"{PREFIX}/api/saved-searches/{created['id']}/transfer", headers=headers,
        json={"owner_id": str(uuid4())},
    )
    itself = client.post(
        f"{PREFIX}/api/saved-searches/{created['id']}/transfer", headers=headers,
        json={"owner_id": created["owner"]["id"]},
    )

    assert nobody.status_code == 400
    assert itself.status_code == 400
    assert "already belongs" in itself.get_json()["message"]


@pytest.mark.database
def test_the_people_directory_answers_a_share_picker(client, monkeypatch):
    headers = _authenticate(monkeypatch, "user", "viewer")

    everyone = client.get(f"{PREFIX}/api/directory/people", headers=headers)
    searched = client.get(f"{PREFIX}/api/directory/people?q=manager", headers=headers)

    assert everyone.status_code == 200
    body = everyone.get_json()
    assert body["total"] > 0
    assert len(body["items"]) <= 50
    person = body["items"][0]
    assert set(person) == {
        "id", "name", "email", "username", "job_title", "avatar_url", "initials", "is_me",
    }
    assert searched.status_code == 200
    assert all(
        "manager" in (item["name"] + item["email"] + item["username"] + (item["job_title"] or "")).lower()
        for item in searched.get_json()["items"]
    )


def test_the_people_directory_requires_a_token(client):
    assert client.get(f"{PREFIX}/api/directory/people").status_code == 401


@pytest.mark.database
def test_the_result_echoes_what_was_searched_for_so_matches_can_be_marked(client, monkeypatch):
    """§6 highlighting marks the executed term, not the one being typed."""
    response = client.post(
        f"{PREFIX}/api/explorer/query", headers=_authenticate(monkeypatch),
        json={"resource_type": "task", "query_text": "  audit  ", "page_size": 5},
    )

    body = response.get_json()
    assert body["query_text"] == "audit"
    assert set(body["searchable"]) == {"reference", "title", "description"}
    assert body["total"] > 0


@pytest.mark.database
def test_a_facet_filter_sent_as_a_list_narrows_the_same_way_as_a_string(client, monkeypatch):
    """The explorer posts JSON, where `?priority=CRITICAL` is `["CRITICAL"]`.

    Stringifying that list produced `"['CRITICAL']"` and a filter that matched
    nothing — an empty table rather than an error, which is the hardest kind of
    wrong answer to notice.
    """
    headers = _authenticate(monkeypatch)
    body = {"resource_type": "task", "columns": ["reference", "priority"], "page_size": 10}

    as_list = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={**body, "filters": {"priority": ["CRITICAL"]}},
    ).get_json()
    as_text = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={**body, "filters": {"priority": "CRITICAL"}},
    ).get_json()
    unfiltered = client.post(f"{PREFIX}/api/explorer/query", headers=headers, json=body).get_json()
    cleared = client.post(
        f"{PREFIX}/api/explorer/query", headers=headers,
        json={**body, "filters": {"priority": []}},
    ).get_json()

    assert as_list["total"] == as_text["total"] > 0
    assert as_list["total"] < unfiltered["total"]
    assert all(item["priority"] == "CRITICAL" for item in as_list["items"])
    # An emptied multi-select means "stop narrowing", not "match nothing".
    assert cleared["total"] == unfiltered["total"]


# ── global search (§32) ──────────────────────────────────────────────────


@pytest.mark.database
def test_global_search_ranks_an_exact_reference_above_a_mention(client, monkeypatch):
    """The whole point of scoring: the record *called* TSK-00042 comes first."""
    response = client.get(
        f"{PREFIX}/api/search/global?q=TSK-00042", headers=_authenticate(monkeypatch)
    )

    assert response.status_code == 200
    body = response.get_json()
    assert body["query"] == "TSK-00042"
    tasks = next(group for group in body["groups"] if group["resource_type"] == "task")
    first = tasks["items"][0]
    assert first["label"] == "TSK-00042"
    assert first["matched_field"] == "reference"
    # Exact beats prefix beats contains; see EXACT/PREFIX/CONTAINS.
    assert first["score"] >= 100
    assert all(first["score"] >= item["score"] for item in tasks["items"])


@pytest.mark.database
def test_global_search_says_which_field_matched_and_shows_it(client, monkeypatch):
    response = client.get(
        f"{PREFIX}/api/search/global?q=migration", headers=_authenticate(monkeypatch)
    )

    body = response.get_json()
    assert body["total"] > 0
    for group in body["groups"]:
        for item in group["items"]:
            assert item["matched_field"]
            assert item["matched_label"]
            # The snippet contains the term it was cut around.
            assert "migration" in item["snippet"].lower()


@pytest.mark.database
def test_global_search_asks_for_a_term_rather_than_failing(client, monkeypatch):
    """An empty box is the normal state of a search page, not a bad request."""
    headers = _authenticate(monkeypatch)

    empty = client.get(f"{PREFIX}/api/search/global", headers=headers)
    single = client.get(f"{PREFIX}/api/search/global?q=a", headers=headers)

    assert empty.status_code == 200
    assert empty.get_json() == {"query": "", "total": 0, "groups": [], "truncated": False}
    assert single.status_code == 200
    assert single.get_json()["total"] == 0


@pytest.mark.database
def test_global_search_only_looks_where_the_caller_may_read(client, monkeypatch):
    """A dataset the role cannot read is not searched, not searched and hidden."""
    from src.services.explorer import resources

    everything = client.get(
        f"{PREFIX}/api/search/global?q=e", headers=_authenticate(monkeypatch)
    )
    searched = client.get(
        f"{PREFIX}/api/search/global?q=re", headers=_authenticate(monkeypatch)
    ).get_json()

    assert everything.status_code == 200
    assert {group["resource_type"] for group in searched["groups"]} <= set(resources())


def test_global_search_requires_a_token(client):
    assert client.get(f"{PREFIX}/api/search/global?q=abc").status_code == 401


# ── data catalogue (§65) ─────────────────────────────────────────────────


@pytest.mark.database
def test_the_catalogue_describes_exactly_the_fields_the_explorer_exposes(client, monkeypatch):
    """Generated from one declaration, so it cannot describe a field that is
    not there or omit one that is — which is how a hand-kept catalogue rots."""
    from src.services.explorer import resources

    response = client.get(f"{PREFIX}/api/catalog/datasets", headers=_authenticate(monkeypatch))

    assert response.status_code == 200
    body = response.get_json()
    assert body["total"] == len(resources())
    for entry in body["items"]:
        declared = resources()[entry["key"]].fields
        assert [field["name"] for field in entry["fields"]] == [
            spec.name for spec in declared.fields
        ]


@pytest.mark.database
def test_completeness_is_measured_against_the_whole_dataset(client, monkeypatch):
    response = client.get(f"{PREFIX}/api/catalog/datasets", headers=_authenticate(monkeypatch))

    tasks = next(item for item in response.get_json()["items"] if item["key"] == "task")
    assert tasks["record_count"] > 0
    reference = next(field for field in tasks["fields"] if field["name"] == "reference")
    description = next(field for field in tasks["fields"] if field["name"] == "description")

    # A required column is complete; an optional one is not, and the count it
    # was derived from is returned beside the percentage.
    assert reference["completeness"] == 100.0
    assert reference["filled"] == tasks["record_count"]
    assert 0 < description["completeness"] < 100
    assert description["filled"] < tasks["record_count"]


@pytest.mark.database
def test_the_catalogue_reports_the_values_a_field_actually_holds(client, monkeypatch):
    """The declared choices are what the code allows; this is what the data has."""
    response = client.get(
        f"{PREFIX}/api/catalog/datasets/task?field=status", headers=_authenticate(monkeypatch)
    )

    body = response.get_json()
    assert body["field"] == "status"
    counts = [entry["count"] for entry in body["values"]]
    assert counts == sorted(counts, reverse=True)
    from src.core import vocabulary

    assert {entry["value"] for entry in body["values"]} <= set(vocabulary.TASK_STATUS)


@pytest.mark.database
def test_the_catalogue_refuses_an_unknown_dataset_or_field(client, monkeypatch):
    headers = _authenticate(monkeypatch)

    dataset = client.get(f"{PREFIX}/api/catalog/datasets/secrets", headers=headers)
    field = client.get(f"{PREFIX}/api/catalog/datasets/task?field=nope", headers=headers)

    assert dataset.status_code == 400
    assert "task" in dataset.get_json()["details"]["available"]
    assert field.status_code == 400
    assert "status" in field.get_json()["details"]["available"]


def test_the_catalogue_requires_a_token(client):
    assert client.get(f"{PREFIX}/api/catalog/datasets").status_code == 401
