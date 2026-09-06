"""Saved reports (§28, §5).

Two properties are worth asserting above everything else.

**A report is a saved analysis, not a second query engine.** Running one has
to return what the workspace would have computed for the same question, or the
report and the screen it was built on disagree about the same data.

**Sharing is the model saved searches use.** The tracker's requirement is one
mechanism, one table, one set of rules — so the tests here are the same tests,
asked of a different resource: a private report is invisible to somebody else,
a member may read and not write, and only the owner deletes.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
REPORTS = f"{PREFIX}/api/reports"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda token: persona_claims(
            _persona_of(token), _role_of(token), sid=f"reports-{_persona_of(token)}"
        ),
    )
    return {"Authorization": f"Bearer reports-{username}-{role}"}


def _persona_of(token: str) -> str:
    return str(token).split("-")[1] if "-" in str(token) else "admin"


def _role_of(token: str) -> str:
    parts = str(token).split("-")
    return parts[2] if len(parts) > 2 else "administrator"


@pytest.fixture()
def report(client, monkeypatch):
    """One report owned by the administrator, removed on the way out."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        REPORTS,
        json={
            "name": "Revenue by channel",
            "resource_type": "order",
            "dimensions": [{"field": "channel"}],
            "metrics": [{"aggregation": "sum", "field": "total"}],
            "period": "all_time",
            "visualization": "bar",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()
    saved = response.get_json()
    try:
        yield saved
    finally:
        _erase(saved["id"])


def _erase(report_id: str) -> None:
    from src.core.db import session_scope
    from src.models.personal import Report, ResourceShare

    with session_scope() as session:
        session.query(ResourceShare).filter(
            ResourceShare.resource_type == "report",
            ResourceShare.resource_id == str(report_id),
        ).delete(synchronize_session=False)
        session.query(Report).filter(Report.id == report_id).delete(synchronize_session=False)


def test_reports_need_a_bearer_token(client):
    assert client.get(REPORTS).status_code == 401
    assert client.post(REPORTS, json={"name": "x"}).status_code == 401


@pytest.mark.database
def test_a_report_stores_the_question_and_how_to_draw_it(report):
    assert report["dimensions"] == [{"field": "channel", "granularity": ""}]
    assert report["metrics"] == [{"aggregation": "sum", "field": "total"}]
    assert report["visualization"] == "bar"
    # Private until somebody says otherwise. Nothing is shared by accident.
    assert report["scope"] == "PRIVATE"


@pytest.mark.database
def test_running_a_report_returns_what_the_workspace_would_have_computed(client, monkeypatch, report):
    headers = _authenticate(monkeypatch)

    run = client.post(f"{REPORTS}/{report['id']}/run", headers=headers).get_json()
    direct = client.post(
        f"{PREFIX}/api/analysis/run",
        json={
            "resource_type": "order",
            "dimensions": [{"field": "channel", "granularity": ""}],
            "measures": [{"aggregation": "sum", "field": "total"}],
            "period": "all_time",
        },
        headers=headers,
    ).get_json()

    # The stored definition is the input to the shared compiler, not a second
    # implementation of it.
    assert run["result"]["rows"] == direct["rows"]
    assert run["result"]["totals"] == direct["totals"]
    assert run["report"]["run_count"] == 1


@pytest.mark.database
def test_a_report_cannot_be_saved_with_a_period_the_compiler_would_refuse(client, monkeypatch):
    response = client.post(
        REPORTS,
        json={"name": "Bad period", "resource_type": "order", "period": "since_tuesday"},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert "last_30_days" in response.get_json()["details"]["allowed"]


@pytest.mark.database
def test_a_report_cannot_name_a_picture_the_platform_cannot_paint(client, monkeypatch):
    response = client.post(
        REPORTS,
        json={"name": "Sankey", "resource_type": "order", "visualization": "sankey"},
        headers=_authenticate(monkeypatch),
    )

    assert response.status_code == 400
    assert "treemap" in response.get_json()["details"]["allowed"]


@pytest.mark.database
def test_a_private_report_is_invisible_to_everybody_else(client, monkeypatch, report):
    manager = _authenticate(monkeypatch, "manager", "manager")

    listed = client.get(REPORTS, headers=manager).get_json()
    assert all(item["id"] != report["id"] for item in listed["items"])
    # Not reachable by direct id either, and the answer does not confirm that
    # it exists (§76).
    assert client.get(f"{REPORTS}/{report['id']}", headers=manager).status_code == 404


@pytest.mark.database
def test_a_public_report_is_readable_by_everyone_and_writable_by_its_owner(client, monkeypatch, report):
    admin = _authenticate(monkeypatch)
    published = client.put(
        f"{REPORTS}/{report['id']}", json={"scope": "PUBLIC"}, headers=admin
    )
    assert published.status_code == 200

    manager = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(f"{REPORTS}/{report['id']}", headers=manager).status_code == 200

    # Readable, and still not theirs to change.
    refused = client.put(
        f"{REPORTS}/{report['id']}", json={"name": "Mine now"}, headers=manager
    )
    assert refused.status_code == 403
    assert client.delete(f"{REPORTS}/{report['id']}", headers=manager).status_code == 403


@pytest.mark.database
def test_a_member_who_wants_their_own_version_duplicates_it(client, monkeypatch, report):
    admin = _authenticate(monkeypatch)
    client.put(f"{REPORTS}/{report['id']}", json={"scope": "PUBLIC"}, headers=admin)

    manager = _authenticate(monkeypatch, "manager", "manager")
    copy = client.post(f"{REPORTS}/{report['id']}/duplicate", headers=manager)

    assert copy.status_code == 201
    body = copy.get_json()
    try:
        # Theirs, and private — a duplicate that inherited the audience would
        # publish somebody else's reading list on their behalf.
        assert body["scope"] == "PRIVATE"
        assert body["can_edit"] is True
        assert body["name"].endswith("(copy)")
        assert body["metrics"] == report["metrics"]
    finally:
        _erase(body["id"])


@pytest.mark.database
def test_reading_reports_and_building_them_are_different_permissions(client, monkeypatch):
    # An analyst reads and builds; a viewer reads and cannot build.
    _authenticate(monkeypatch)
    monkeypatch.setattr(
        "src.core.auth._permissions_for", lambda *_args: {"records.view", "reports.view"}
    )

    response = client.post(
        REPORTS,
        json={"name": "Not mine to build", "resource_type": "order"},
        headers={"Authorization": "Bearer reports-user-viewer"},
    )

    assert response.status_code == 403
    assert response.get_json()["details"]["missing"] == ["reports.manage"]


@pytest.mark.database
def test_deleting_a_report_answers_with_json_the_client_can_read(client, monkeypatch):
    """The response, not only the row.

    The route converter hands the handler a `UUID`, and echoing it back
    unconverted is a 500 *after* the delete has committed — a request that
    reports failure having succeeded, which is the worst of both.
    """
    headers = _authenticate(monkeypatch)
    created = client.post(
        REPORTS, json={"name": "Deletable", "resource_type": "order"}, headers=headers
    ).get_json()

    response = client.delete(f"{REPORTS}/{created['id']}", headers=headers)

    assert response.status_code == 200
    assert response.get_json() == {"deleted": True, "id": created["id"]}
    assert client.get(f"{REPORTS}/{created['id']}", headers=headers).status_code == 404
    _erase(created["id"])


@pytest.mark.database
def test_a_missing_report_is_a_404(client, monkeypatch):
    assert client.get(f"{REPORTS}/{uuid4()}", headers=_authenticate(monkeypatch)).status_code == 404
