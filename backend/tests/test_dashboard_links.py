"""Public and embeddable dashboard links (§25), with expiry and passwords.

The claims:

* **Only the owner, holding `dashboards.publish`, publishes**; links are
  validated (future expiry, real origins, a password of some length).
* **The token is the credential**: an anonymous reader gets the dashboard with
  every widget answered on the server — read-only, as the owner — and personal
  widgets withheld.
* **A password is exchanged for a grant**, and changing it lapses the grant.
* **Revoked and expired links are gone (410)**, embedding is refused from an
  origin not on the list, every view counts, and both doors are rate-limited.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import uuid4

import pytest

from src.config import Config
from src.core.clock import now
from src.services import dashboard_links as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
PUBLIC = f"{PREFIX}/public/dashboards"

pytestmark = pytest.mark.database


def _auth(monkeypatch, username: str = "admin", role: str = "administrator") -> dict[str, str]:
    monkeypatch.setattr("src.core.auth.verify_token",
                        lambda _t: persona_claims(username, role, sid=f"links-{username}"))
    return {"Authorization": f"Bearer links-{username}"}


@pytest.fixture(autouse=True)
def _fresh_limits(monkeypatch):
    service._local_counts.clear()
    monkeypatch.setattr(service.cache, "incr", lambda *_a, **_k: 0)


@pytest.fixture()
def headers(monkeypatch):
    return _auth(monkeypatch)


@pytest.fixture()
def dashboard(client, headers):
    """A dashboard of the admin's with one widget of every published shape, and one private."""
    made = client.post(f"{PREFIX}/api/dashboards", json={"name": f"Public probe {uuid4().hex[:6]}"}, headers=headers)
    assert made.status_code == 201, made.get_json()
    ident = made.get_json()["id"]
    widgets = [
        {"kind": "KPI", "title": "Tickets", "config": {"entity": "ticket"}},
        {"kind": "ANALYTICS", "title": "Orders", "config": {"entity": "order"}},
        {"kind": "BAR_CHART", "title": "By status", "config": {"entity": "ticket"}},
        {"kind": "LINE_CHART", "title": "Over time", "config": {"entity": "order", "aggregation": "sum", "measure": "total"}},
        {"kind": "AREA_CHART", "title": "Odd period", "config": {"entity": "order"}},
        {"kind": "HEATMAP", "title": "Heat", "config": {"entity": "ticket"}},
        {"kind": "TABLE", "title": "Latest", "config": {"entity": "customer"}},
        {"kind": "LIST", "title": "Newest", "config": {"entity": "task"}},
        {"kind": "MAIL", "title": "My mail", "config": {}},
    ]
    for widget in widgets:
        response = client.post(f"{PREFIX}/api/dashboards/{ident}/widgets", json=widget, headers=headers)
        assert response.status_code == 201, (widget, response.get_json())
    return ident


def _link(client, headers, dashboard, **body):
    response = client.post(f"{PREFIX}/api/dashboards/{dashboard}/links", json=body, headers=headers)
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def test_links_need_a_token(client):
    assert client.get(f"{PREFIX}/api/dashboards/{uuid4()}/links").status_code == 401


def test_an_open_link_serves_every_widget_answered(client, headers, dashboard):
    link = _link(client, headers, dashboard, label="Board pack")
    assert link["status"] == "ACTIVE" and link["has_password"] is False
    assert link["path"] == f"/share/dashboards/{link['token']}"

    meta = client.get(f"{PUBLIC}/{link['token']}").get_json()
    assert meta["has_password"] is False
    view = client.get(f"{PUBLIC}/{link['token']}/view")
    assert view.status_code == 200, view.get_json()
    body = view.get_json()
    types = {w["title"]: w["data"]["type"] for w in body["widgets"]}
    assert types == {
        "Tickets": "metrics", "Orders": "metrics", "By status": "chart", "Over time": "chart",
        "Heat": "chart", "Latest": "rows", "Newest": "rows", "My mail": "private", "Odd period": "chart",
    }
    over_time = next(w for w in body["widgets"] if w["title"] == "Over time")["data"]
    assert over_time["chart"] == "line"
    assert over_time["result"]["measures"][0]["aggregation"] == "sum"
    latest = next(w for w in body["widgets"] if w["title"] == "Latest")["data"]
    assert latest["table"] is True and len(latest["columns"]) == 3
    assert body["dashboard"]["owner"] == "Ada Administrator"

    listed = client.get(f"{PREFIX}/api/dashboards/{dashboard}/links", headers=headers).get_json()
    assert listed["items"][0]["view_count"] == 1
    assert listed["can_publish"] is True


def test_a_password_link_needs_a_grant_and_a_new_password_lapses_it(client, headers, dashboard):
    link = _link(client, headers, dashboard, password="opensesame",
                 expires_at=(now() + timedelta(days=3)).isoformat())
    assert link["has_password"] is True and link["expires_at"]
    assert client.get(f"{PUBLIC}/{link['token']}").get_json()["has_password"] is True

    locked = client.get(f"{PUBLIC}/{link['token']}/view")
    assert locked.status_code == 401
    assert locked.get_json()["details"]["reason"] == "password_required"
    wrong = client.post(f"{PUBLIC}/{link['token']}/unlock", json={"password": "nope"})
    assert wrong.status_code == 401
    assert wrong.get_json()["details"]["reason"] == "wrong_password"
    grant = client.post(f"{PUBLIC}/{link['token']}/unlock", json={"password": "opensesame"}).get_json()["grant"]
    assert client.get(f"{PUBLIC}/{link['token']}/view", headers={"X-Share-Grant": grant}).status_code == 200
    assert client.get(f"{PUBLIC}/{link['token']}/view", headers={"X-Share-Grant": "forged"}).status_code == 401

    client.put(f"{PREFIX}/api/dashboards/{dashboard}/links/{link['id']}", json={"password": "a-new-secret"},
               headers=headers)
    assert client.get(f"{PUBLIC}/{link['token']}/view", headers={"X-Share-Grant": grant}).status_code == 401
    # Taking the password off opens it, and old grants are irrelevant.
    opened = client.put(f"{PREFIX}/api/dashboards/{dashboard}/links/{link['id']}", json={"password": ""},
                        headers=headers).get_json()
    assert opened["has_password"] is False
    assert client.post(f"{PUBLIC}/{link['token']}/unlock", json={}).get_json() == {"grant": None, "expires_in": None}
    assert client.get(f"{PUBLIC}/{link['token']}/view").status_code == 200


def test_revoked_and_expired_links_are_gone(client, headers, dashboard):
    link = _link(client, headers, dashboard)
    revoked = client.delete(f"{PREFIX}/api/dashboards/{dashboard}/links/{link['id']}", headers=headers).get_json()
    assert revoked["status"] == "REVOKED"
    gone = client.get(f"{PUBLIC}/{link['token']}/view")
    assert gone.status_code == 410
    assert gone.get_json()["details"]["reason"] == "revoked"
    assert client.put(f"{PREFIX}/api/dashboards/{dashboard}/links/{link['id']}", json={"label": "x"},
                      headers=headers).status_code == 400
    assert client.delete(f"{PREFIX}/api/dashboards/{dashboard}/links/{link['id']}", headers=headers).status_code == 200

    from src.core.db import session_scope
    from src.models.records_analytics import DashboardLink

    expiring = _link(client, headers, dashboard)
    with session_scope() as session:
        session.get(DashboardLink, expiring["id"]).expires_at = now() - timedelta(minutes=1)
    expired = client.get(f"{PUBLIC}/{expiring['token']}")
    assert expired.status_code == 410
    assert expired.get_json()["details"]["reason"] == "expired"
    assert client.get(f"{PUBLIC}/no-such-token/view").status_code == 404
    assert client.get(f"{PUBLIC}/{'x' * 70}").status_code == 404


def test_embedding_follows_the_allowed_origins(client, headers, dashboard):
    closed = _link(client, headers, dashboard)
    refused = client.get(f"{PUBLIC}/{closed['token']}/view?embed_origin=https://intranet.example")
    assert refused.status_code == 403
    assert refused.get_json()["details"]["reason"] == "origin_not_allowed"

    listed = _link(client, headers, dashboard, allow_embed=True, allowed_origins=["https://intranet.example/"])
    assert listed["allowed_origins"] == ["https://intranet.example"]
    assert client.get(f"{PUBLIC}/{listed['token']}/view?embed_origin=https://intranet.example").status_code == 200
    assert client.get(f"{PUBLIC}/{listed['token']}/view?embed_origin=https://evil.example").status_code == 403
    assert client.get(f"{PUBLIC}/{listed['token']}/view?embed_origin=nonsense").status_code == 403
    anywhere = _link(client, headers, dashboard, allow_embed=True)
    assert client.get(f"{PUBLIC}/{anywhere['token']}/view?embed_origin=https://any.example").get_json()["link"]["embedded"] is True


@pytest.mark.parametrize("body,field", [
    ({"expires_at": "soon"}, "expires_at"),
    ({"expires_at": "2001-01-01"}, "expires_at"),
    ({"password": "abc"}, "password"),
    ({"password": "x" * 129}, "password"),
    ({"allowed_origins": "https://a.example"}, "allowed_origins"),
    ({"allowed_origins": ["ftp://a.example"]}, "allowed_origins"),
    ({"allowed_origins": [f"https://{i}.example" for i in range(11)]}, "allowed_origins"),
])
def test_a_bad_link_is_refused_and_names_its_field(client, headers, dashboard, body, field):
    response = client.post(f"{PREFIX}/api/dashboards/{dashboard}/links", json=body, headers=headers)
    assert response.status_code == 400
    assert response.get_json()["details"]["field"] == field


def test_only_the_owner_with_publish_may_publish(client, monkeypatch, headers, dashboard):
    assert client.post(f"{PREFIX}/api/dashboards/{dashboard}/links", json=[], headers=headers).status_code == 400
    operator = _auth(monkeypatch, "operator", "operator")
    # Not theirs to see.
    assert client.get(f"{PREFIX}/api/dashboards/{dashboard}/links", headers=operator).status_code == 404
    mine = client.post(f"{PREFIX}/api/dashboards", json={"name": f"Operator board {uuid4().hex[:6]}"}, headers=operator)
    assert mine.status_code == 201
    refused = client.post(f"{PREFIX}/api/dashboards/{mine.get_json()['id']}/links", json={}, headers=operator)
    assert refused.status_code == 403
    assert client.get(f"{PREFIX}/api/dashboards/{mine.get_json()['id']}/links",
                      headers=operator).get_json()["can_publish"] is False


def test_both_doors_are_rate_limited(client, headers, dashboard, monkeypatch):
    link = _link(client, headers, dashboard, password="opensesame")
    monkeypatch.setattr(service, "UNLOCK_LIMIT", 2)
    for _ in range(2):
        client.post(f"{PUBLIC}/{link['token']}/unlock", json={"password": "wrong"})
    limited = client.post(f"{PUBLIC}/{link['token']}/unlock", json={"password": "opensesame"})
    assert limited.status_code == 429
    monkeypatch.setattr(service, "VIEW_LIMIT", 1)
    client.get(f"{PUBLIC}/{link['token']}", headers={"X-Forwarded-For": "203.0.113.9"})
    assert client.get(f"{PUBLIC}/{link['token']}", headers={"X-Forwarded-For": "203.0.113.9"}).status_code == 429
    assert client.get(f"{PUBLIC}/{link['token']}", headers={"X-Forwarded-For": "203.0.113.10"}).status_code == 200


def test_a_widget_that_fails_says_so_in_place(client, headers, dashboard):
    from src.core.db import session_scope
    from src.models.personal import DashboardWidget

    with session_scope() as session:
        session.add(DashboardWidget(dashboard_id=dashboard, kind="AREA_CHART", title="Stale period",
                                    config={"entity": "order", "period": "current_month"}, x=0, y=30, width=4,
                                    height=2, position=98))
        session.add(DashboardWidget(dashboard_id=dashboard, kind="REPORT", title="Broken report",
                                    config={}, x=0, y=20, width=4, height=2, position=99))
        session.add(DashboardWidget(dashboard_id=dashboard, kind="REPORT", title="Gone report",
                                    config={"report_id": str(uuid4())}, x=4, y=20, width=4, height=2, position=100))
        session.add(DashboardWidget(dashboard_id=dashboard, kind="KPI", title="Unchosen",
                                    config={}, x=8, y=20, width=4, height=2, position=101))
        session.add(DashboardWidget(dashboard_id=dashboard, kind="CHART", title="Unknown set",
                                    config={"entity": "planet", "chart": "pie"}, x=0, y=22, width=4, height=2, position=102))
    link = _link(client, headers, dashboard)
    body = client.get(f"{PUBLIC}/{link['token']}/view").get_json()
    data = {w["title"]: w["data"] for w in body["widgets"]}
    assert data["Broken report"]["type"] == "error"
    assert data["Gone report"]["type"] == "error"
    assert data["Unchosen"]["type"] == "empty"
    assert data["Unknown set"]["type"] == "error"
    assert data["Stale period"]["type"] == "chart"


def test_a_saved_report_widget_is_drawn_from_the_report(client, headers, dashboard):
    report = client.post(f"{PREFIX}/api/reports", json={
        "name": f"Public report {uuid4().hex[:6]}", "resource_type": "ticket",
        "dimensions": [{"field": "status"}], "metrics": [{"aggregation": "count"}], "visualization": "PIE",
    }, headers=headers)
    assert report.status_code == 201, report.get_json()
    client.post(f"{PREFIX}/api/dashboards/{dashboard}/widgets", json={
        "kind": "REPORT", "title": "Saved", "config": {"report_id": report.get_json()["id"]}}, headers=headers)
    link = _link(client, headers, dashboard)
    saved = next(w for w in client.get(f"{PUBLIC}/{link['token']}/view").get_json()["widgets"] if w["title"] == "Saved")
    assert saved["data"]["type"] == "chart"
    assert saved["data"]["chart"] == "pie"


def test_an_owner_who_left_takes_the_link_with_them(client, headers, dashboard, monkeypatch):
    link = _link(client, headers, dashboard)

    def gone(*_a, **_k):
        raise service._gone("The owner of this dashboard no longer has an account.", "owner_gone")

    monkeypatch.setattr(service, "_owner_principal", gone)
    response = client.get(f"{PUBLIC}/{link['token']}/view")
    assert response.status_code == 410
    assert response.get_json()["details"]["reason"] == "owner_gone"


def test_the_owner_principal_reads_and_nothing_else():
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.core.errors import ApiError
    from src.models.identity import User

    with session_scope() as session:
        admin = session.scalars(select(User).where(User.username == "admin")).first()
        principal = service._owner_principal(session, admin.id)
        assert principal.permissions <= service.READ_ONLY
        assert principal.can("records.view")
        with pytest.raises(ApiError):
            service._owner_principal(session, uuid4())
