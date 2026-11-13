"""Feature flags, enforced end to end (§27). — Through the database."""

from __future__ import annotations

import uuid

import pytest

from src.core import features
from src.core.feature_catalogue import (
    FEATURES_BY_KEY,
)
from tests.feature_flags_support import (  # noqa: F401
    PREFIX,
    _all_on,
    _authenticate,
    _state,
    flags,
    temp_flag,
)
from tests.patching import patch_package


@pytest.mark.database
def test_a_flag_change_reaches_the_gate_and_the_profile_at_once(client, monkeypatch, temp_flag):
    """Create off → refused; switch on → served; /api/me says so immediately."""
    headers = _authenticate(monkeypatch)
    monkeypatch.setitem(features._rule_owner, f"{PREFIX}/api/maps/catalog", temp_flag)

    created = client.post(f"{PREFIX}/admin/flags", json={"key": temp_flag, "name": "Temp"}, headers=headers)
    assert created.status_code == 201
    assert created.get_json()["in_catalogue"] is False
    assert client.get(f"{PREFIX}/api/maps/catalog", headers=headers).get_json()["feature"] == temp_flag
    assert client.get(f"{PREFIX}/api/me", headers=headers).get_json()["features"][temp_flag] is False

    switched = client.put(
        f"{PREFIX}/admin/flags/{temp_flag}",
        json={"enabled": True, "rollout_percentage": 100}, headers=headers,
    )
    assert switched.status_code == 200
    assert client.get(f"{PREFIX}/api/maps/catalog", headers=headers).status_code == 200
    assert client.get(f"{PREFIX}/api/me", headers=headers).get_json()["features"][temp_flag] is True

    # Targeting: on for a group and an organization only.
    org = str(uuid.uuid4())
    answer = client.put(
        f"{PREFIX}/admin/flags/{temp_flag}",
        json={"rollout_percentage": 0, "target_group_ids": ["Nobody"], "target_organization_ids": [org]},
        headers=headers,
    ).get_json()
    assert answer["target_group_ids"] == ["Nobody"]
    assert answer["target_organization_ids"] == [org]
    assert client.get(f"{PREFIX}/api/maps/catalog", headers=headers).get_json()["error"] == "feature_disabled"

    history = client.get(f"{PREFIX}/admin/flags/{temp_flag}/history", headers=headers).get_json()
    assert len(history["items"]) == 3
    assert history["items"][0]["after"]["target_organization_ids"] == [org]

    client.put(f"{PREFIX}/admin/flags/{temp_flag}", json={"enabled": False}, headers=headers)
    assert client.delete(f"{PREFIX}/admin/flags/{temp_flag}", headers=headers).status_code == 200


@pytest.mark.database
def test_flag_history_and_preview_validate_their_input(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    assert client.get(f"{PREFIX}/admin/flags/no-such-flag/history", headers=headers).status_code == 404
    assert client.get(f"{PREFIX}/admin/flags/maps/history?limit=nope", headers=headers).status_code == 200
    assert client.get(f"{PREFIX}/admin/flags/preview", headers=headers).status_code == 400
    missing = client.get(f"{PREFIX}/admin/flags/preview?user_id={uuid.uuid4()}", headers=headers)
    assert missing.status_code == 404


@pytest.mark.database
def test_preview_as_a_role_and_as_a_person(client, monkeypatch, flags):
    headers = _authenticate(monkeypatch)
    flags.set(_all_on(
        maps=_state("maps", rollout_percentage=0, target_roles=("ADMINISTRATOR",)),
        chat=_state("chat", rollout_percentage=40),
    ))
    viewer = client.get(f"{PREFIX}/admin/flags/preview?role=viewer", headers=headers).get_json()
    assert viewer["role"] == "VIEWER"
    assert viewer["features"]["maps"] is False
    assert "maps" in viewer["off"]
    assert viewer["depends_on_person"] == ["chat"]
    admin = client.get(f"{PREFIX}/admin/flags/preview?role=ADMINISTRATOR", headers=headers).get_json()
    assert admin["features"]["maps"] is True

    me = client.get(f"{PREFIX}/api/me", headers=headers).get_json()["user"]
    person = client.get(f"{PREFIX}/admin/flags/preview?user_id={me['id']}", headers=headers).get_json()
    assert person["user_id"] == me["id"]
    assert person["depends_on_person"] == []


@pytest.mark.database
def test_the_flag_list_carries_the_catalogue_and_filters(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = client.get(f"{PREFIX}/admin/flags", headers=headers).get_json()
    rows = {row["key"]: row for row in body["items"]}
    assert set(FEATURES_BY_KEY) <= set(rows)
    assert rows["time-tracking"]["area"] == "work"
    assert "/time" in rows["time-tracking"]["controls"]["routes"]
    assert any(area["key"] == "ai" for area in body["areas"])

    ai = client.get(f"{PREFIX}/admin/flags?area=ai", headers=headers).get_json()
    assert ai["items"] and all(row["area"] == "ai" for row in ai["items"])
    found = client.get(f"{PREFIX}/admin/flags?q=timers", headers=headers).get_json()
    assert [row["key"] for row in found["items"]] == ["time-tracking"]


@pytest.mark.database
def test_a_schedule_on_a_report_is_refused_while_scheduling_is_off(client, monkeypatch, flags):
    headers = _authenticate(monkeypatch)
    reports = client.get(f"{PREFIX}/api/reports?page_size=1", headers=headers).get_json()
    report = (reports.get("items") or [None])[0]
    if report is None:
        pytest.skip("no seeded report")
    flags.off("report-scheduling")
    refused = client.post(
        f"{PREFIX}/api/reports",
        json={"name": "Never created", "resource_type": report["resource_type"], "schedule": "0 7 * * 1"},
        headers=headers,
    )
    assert refused.status_code == 404
    assert refused.get_json()["feature"] == "report-scheduling"


@pytest.mark.database
def test_sync_flags_creates_relabels_resets_and_retires_in_a_rolled_back_transaction():
    from sqlalchemy import select
    from sqlalchemy.orm import Session

    from src.core.db import get_engine
    from src.models.platform import FeatureFlag
    from src.seed import runner

    with Session(get_engine()) as session:
        rows = {row.key: row for row in session.scalars(select(FeatureFlag)).all()}
        session.delete(rows["maps"])
        rows["calendar"].name = "Old name"
        session.add(FeatureFlag(key="mobile-layout", name="Mobile", enabled=True))
        untouched = rows["global-search"]
        untouched.enabled, untouched.rollout_percentage = False, 5
        session.flush()

        result = runner.sync_flags(session)

        assert result["created"] >= 1 and result["removed"] == 1
        assert result["relabelled"] >= 1 and result["reset"] >= 1
        fresh = {row.key: row for row in session.scalars(select(FeatureFlag)).all()}
        assert fresh["maps"].enabled is True and fresh["maps"].rollout_percentage == 100
        assert fresh["calendar"].name == FEATURES_BY_KEY["calendar"].name
        assert "mobile-layout" not in fresh

        # A decision (a FLAG_CHANGE in the audit trail) survives a sync and
        # yields to a reset.
        from src.core.clock import now as clock_now
        from src.models.platform import AuditLog

        decided = fresh["calendar"]
        decided.enabled = False
        session.add(AuditLog(
            occurred_at=clock_now(), action="FLAG_CHANGE", resource_type="feature_flag",
            resource_id=str(decided.id), resource_label="Calendar",
        ))
        session.flush()
        runner.sync_flags(session)
        assert decided.enabled is False
        assert runner.sync_flags(session, reset=True)["reset"] >= 1
        assert decided.enabled is True
        session.rollback()
    features.invalidate()


@pytest.mark.database
def test_the_planning_scheduler_skips_a_switched_off_job(flags):
    from sqlalchemy.orm import Session

    from src.core.db import get_engine
    from src.services.work import task_templates

    flags.off("recurring-tasks", "sprints")
    with Session(get_engine()) as session:
        assert task_templates.run_scheduler(session)["results"] == {}
        session.rollback()


@pytest.mark.database
def test_the_flag_endpoints_filter_validate_and_refuse(client, monkeypatch, temp_flag):
    headers = _authenticate(monkeypatch)
    flags_url = f"{PREFIX}/admin/flags"
    assert all(row["enabled"] for row in client.get(f"{flags_url}?state=on", headers=headers).get_json()["items"])
    assert not any(row["enabled"] for row in client.get(f"{flags_url}?state=off", headers=headers).get_json()["items"])
    assert all(row["stage"] == "BETA" for row in client.get(f"{flags_url}?stage=beta", headers=headers).get_json()["items"])

    assert client.post(flags_url, json={"key": "", "name": "x"}, headers=headers).status_code == 400
    assert client.post(flags_url, json={"key": temp_flag}, headers=headers).status_code == 400
    assert client.post(flags_url, json={"key": temp_flag, "name": "Temp", "stage": "alpha"}, headers=headers).status_code == 201
    assert client.post(flags_url, json={"key": temp_flag, "name": "Temp"}, headers=headers).status_code == 409

    item = f"{flags_url}/{temp_flag}"
    answer = client.put(item, json={
        "target_roles": ["manager"], "target_user_ids": [str(uuid.uuid4())], "stage": "ga",
        "experimental": False, "description": "  for the test  ", "target_group_ids": [],
        "target_organization_ids": [],
    }, headers=headers).get_json()
    assert answer["target_roles"] == ["MANAGER"] and answer["stage"] == "GA"
    assert answer["experimental"] is False and answer["description"] == "for the test"
    assert answer["target_group_ids"] == [] and answer["target_organization_ids"] == []
    assert client.put(item, json={"rollout_percentage": "lots"}, headers=headers).status_code == 400
    assert client.put(item, json={"rollout_percentage": 101}, headers=headers).status_code == 400
    assert client.put(item, json={"target_group_ids": "ops"}, headers=headers).status_code == 400
    assert client.put(item, json={"target_roles": "MANAGER"}, headers=headers).status_code == 400
    assert client.put(f"{flags_url}/no-such-flag", json={"enabled": True}, headers=headers).status_code == 404
    assert client.delete(f"{flags_url}/no-such-flag", headers=headers).status_code == 404

    client.put(item, json={"enabled": True, "rollout_percentage": 100}, headers=headers)
    assert client.delete(item, headers=headers).status_code == 409


@pytest.mark.database
def test_preview_as_a_group_and_an_organization(client, monkeypatch, flags):
    headers = _authenticate(monkeypatch)
    org = str(uuid.uuid4())
    flags.set(_all_on(
        maps=_state("maps", rollout_percentage=0, target_group_ids=("Field ops",)),
        chat=_state("chat", rollout_percentage=0, target_organization_ids=(org,)),
    ))
    patch_package(monkeypatch, features, "_group_ids", lambda uid: ())
    answer = client.get(
        f"{PREFIX}/admin/flags/preview?role=VIEWER&group=Field%20ops&organization_id={org}", headers=headers,
    ).get_json()
    assert answer["features"]["maps"] is True
    assert answer["features"]["chat"] is True
