"""Feature flags, enforced end to end (§27).

What is asserted, and why each matters:

* **every endpoint in the map has a flag decision** — owned by exactly one
  flag or declared core. A new endpoint with no decision fails here, which is
  the only way a central gate stays complete;
* **every flagged endpoint refuses when its flag is off and works when it is
  on**, parametrised over the map, with the handler stubbed so the assertion
  is about the gate and nothing else;
* the refusal is the documented envelope — 404 `feature_disabled` + the key;
* rollout and targeting (people, roles, groups, organizations, percentage),
  parents, the in-process cache and its invalidation, jobs, the live channel,
  the report-scheduling payload rule, preview and history;
* the frontend's route map and feature keys agree with the catalogue.
"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest

from src.api import endpoint_map
from src.config import Config
from src.core import features
from src.core.feature_catalogue import CORE_ENDPOINTS, FEATURES, FEATURES_BY_KEY, RETIRED
from src.core.features import FeatureDisabledError, FlagState
from src.services.platform import settings as service

PREFIX = Config.API_PREFIX
REPO = Path(__file__).resolve().parents[2]


def _state(key: str, enabled: bool = True, **kwargs) -> FlagState:
    values = {
        "rollout_percentage": 100, "target_user_ids": (), "target_roles": (),
        "target_group_ids": (), "target_organization_ids": (),
    }
    values.update(kwargs)
    return FlagState(key=key, enabled=enabled, **values)


def _all_on(**overrides: FlagState) -> dict[str, FlagState]:
    states = {feature.key: _state(feature.key) for feature in FEATURES}
    states.update(overrides)
    return states


@pytest.fixture()
def flags(monkeypatch):
    """Control the flag snapshot without touching the shared database."""
    current: dict[str, dict[str, FlagState]] = {"states": _all_on()}
    monkeypatch.setattr(features, "snapshot", lambda: current["states"])

    def set_off(*keys: str) -> None:
        current["states"] = _all_on(**{key: _state(key, enabled=False) for key in keys})

    def set_states(states: dict[str, FlagState]) -> None:
        current["states"] = states

    return SimpleNamespace(off=set_off, set=set_states, current=current)


# ── The map ──────────────────────────────────────────────────────────────

ENTRIES = endpoint_map.load()["endpoints"]
FLAGGED = [entry for entry in ENTRIES if features.owner_of(entry["api_url"])[0]]


@pytest.mark.parametrize("entry", ENTRIES, ids=lambda e: e["operation_name"])
def test_every_endpoint_has_a_flag_decision(entry):
    """Owned by a flag or declared core — never undecided."""
    key, decided = features.owner_of(entry["api_url"])
    assert decided, (
        f"{entry['api_url']} belongs to no feature flag and is not in CORE_ENDPOINTS — "
        "add it to a Feature.endpoints in core/feature_catalogue.py, or to CORE_ENDPOINTS"
    )
    assert key is None or key in FEATURES_BY_KEY


def test_the_flag_management_endpoints_are_never_flagged():
    for entry in ENTRIES:
        if entry["api_url"].startswith("/admin/flags") or entry["api_url"] in ("/api/me",):
            assert features.owner_of(entry["api_url"])[0] is None, entry["api_url"]


def test_every_endpoint_pattern_in_the_catalogue_claims_something():
    """A pattern that matches nothing is a typo that gates nothing."""
    urls = [entry["api_url"] for entry in ENTRIES]
    for feature in FEATURES:
        for pattern in feature.endpoints:
            assert any(features._score(pattern, url) is not None for url in urls), (feature.key, pattern)
    for pattern in CORE_ENDPOINTS:
        assert any(features._score(pattern, url) is not None for url in urls), pattern


def _url(api_url: str) -> str:
    def fill(match: re.Match) -> str:
        return str(uuid.uuid4()) if match.group(1) == "uuid" else "x"

    return PREFIX + re.sub(r"<(\w+):\w+>", fill, api_url)


@pytest.mark.parametrize("entry", FLAGGED, ids=lambda e: e["operation_name"])
def test_a_flagged_endpoint_refuses_when_off_and_works_when_on(entry, client, flags, monkeypatch):
    key = features.owner_of(entry["api_url"])[0]
    module = __import__(entry["exec_method"]["module_name"], fromlist=["_"])
    calls: list[str] = []

    def stub(*_args, **_kwargs):
        calls.append("called")
        return {"stub": True}, 200

    monkeypatch.setattr(module, entry["exec_method"]["method_name"], stub)
    if not entry["api_url"].startswith("/public/"):
        # A signed-in caller: anonymous calls to these get the handler's 401.
        monkeypatch.setattr(features, "_caller", lambda: SimpleNamespace(
            user_id=uuid.uuid4(), role_code="ADMINISTRATOR", groups=(), organization_id=None,
        ))
    method = entry["request_method"][0].lower()
    url = _url(entry["api_url"])

    flags.off(key)
    refused = getattr(client, method)(url, json={})
    assert refused.status_code == 404, (key, url, refused.get_json())
    assert refused.get_json() == {
        "error": "feature_disabled", "feature": key, "message": f"{FEATURES_BY_KEY[key].name} is switched off.",
    }
    assert calls == []

    flags.off()
    allowed = getattr(client, method)(url, json={})
    assert allowed.status_code == 200, (key, url, allowed.get_json())
    assert allowed.get_json() == {"stub": True}


def test_a_child_endpoint_refuses_when_only_its_parent_is_off(client, flags, monkeypatch):
    import src.api.automation.workflows as module

    monkeypatch.setattr(module, "graph", lambda *a, **k: ({"stub": True}, 200))
    _signed_in(monkeypatch)
    flags.off("workflows")
    answer = client.get(f"{PREFIX}/api/automations/rules/{uuid.uuid4()}/graph")
    assert answer.status_code == 404
    assert answer.get_json()["feature"] == "workflow-canvas"


def _signed_in(monkeypatch):
    monkeypatch.setattr(features, "_caller", lambda: SimpleNamespace(
        user_id=uuid.uuid4(), role_code="ADMINISTRATOR", groups=(), organization_id=None,
    ))


def test_an_anonymous_call_to_a_switched_off_endpoint_gets_the_401_first(client, flags):
    flags.off("maps")
    assert client.get(f"{PREFIX}/api/maps/catalog").status_code == 401


def test_ai_master_switch_takes_every_ai_endpoint_with_it(client, flags, monkeypatch):
    import src.api.ai.assistant as module

    _signed_in(monkeypatch)
    monkeypatch.setattr(module, "brief", lambda *a, **k: ({"stub": True}, 200))
    flags.off("ai")
    assert client.get(f"{PREFIX}/api/assistant/brief").get_json()["error"] == "feature_disabled"


def test_core_endpoints_are_untouched_by_every_flag_being_off(client, flags, monkeypatch):
    import src.api.platform.health as module

    monkeypatch.setattr(module, "liveness", lambda *a, **k: ({"stub": True}, 200))
    flags.off(*FEATURES_BY_KEY)
    assert client.get(f"{PREFIX}/health/live").status_code == 200


def test_impersonation_header_is_refused_while_impersonation_is_off(client, flags):
    flags.off("impersonation")
    answer = client.get(f"{PREFIX}/health/live", headers={"X-Impersonate-User": str(uuid.uuid4())})
    assert answer.status_code == 404
    assert answer.get_json()["feature"] == "impersonation"


def test_a_preflight_is_never_gated(client, flags):
    flags.off("maps")
    assert client.options(f"{PREFIX}/api/maps/catalog").status_code != 404


def test_the_gate_evaluates_the_signed_in_caller(client, flags, monkeypatch):
    """Targeted at a role: on for an administrator, off for a viewer."""
    import src.api.records.maps as module

    monkeypatch.setattr(module, "catalogue", lambda *a, **k: ({"stub": True}, 200))
    flags.set(_all_on(maps=_state("maps", rollout_percentage=0, target_roles=("ADMINISTRATOR",))))
    admin = SimpleNamespace(user_id=uuid.uuid4(), role_code="ADMINISTRATOR", groups=(), organization_id=None)
    viewer = SimpleNamespace(user_id=uuid.uuid4(), role_code="VIEWER", groups=(), organization_id=None)

    monkeypatch.setattr(features, "_caller", lambda: admin)
    assert client.get(f"{PREFIX}/api/maps/catalog").status_code == 200
    monkeypatch.setattr(features, "_caller", lambda: viewer)
    assert client.get(f"{PREFIX}/api/maps/catalog").get_json()["error"] == "feature_disabled"


def test_a_bad_token_reads_as_anonymous_to_the_gate(monkeypatch):
    def boom(**_):
        raise RuntimeError("bad token")

    monkeypatch.setattr("src.core.auth.caller.principal_from_request", boom)
    assert features._caller() is None


# ── The rule ─────────────────────────────────────────────────────────────


def test_evaluate_off_means_off_for_everybody():
    assert service.evaluate(enabled=False, key="k", rollout=100, user_ids=["u"], user_id="u") is False


@pytest.mark.parametrize(
    ("targets", "reader"),
    [
        ({"user_ids": ["7"]}, {"user_id": "7"}),
        ({"roles": ["MANAGER"]}, {"role_code": "MANAGER"}),
        ({"group_ids": ["ops"]}, {"groups": ("ops",)}),
        ({"organization_ids": ["org-1"]}, {"organization_id": "org-1"}),
    ],
)
def test_evaluate_a_target_always_has_it(targets, reader):
    assert service.evaluate(enabled=True, key="k", rollout=0, **targets, **reader) is True
    assert service.evaluate(enabled=True, key="k", rollout=0, **targets) is False


def test_evaluate_percentage_is_stable_and_proportional():
    users = [uuid.UUID(int=i) for i in range(400)]
    first = [service.evaluate(enabled=True, key="k", rollout=25, user_id=u) for u in users]
    again = [service.evaluate(enabled=True, key="k", rollout=25, user_id=u) for u in users]
    assert first == again
    assert 60 < sum(first) < 140
    assert service.evaluate(enabled=True, key="k", rollout=25, user_id=None) is False
    assert service.evaluate(enabled=True, key="k", rollout=100) is True


def test_is_on_reads_a_row_with_organization_targeting():
    row = SimpleNamespace(
        enabled=True, key="k", rollout_percentage=0, target_user_ids=None, target_roles=None,
        target_group_ids=None, target_organization_ids=["o"],
    )
    assert service.is_on(row, user_id=None, role_code=None, organization_id="o") is True
    assert service.is_on(row, user_id=None, role_code=None) is False


def test_enabled_map_applies_parents_and_unknown_keys(flags):
    flags.set(_all_on(ai=_state("ai", enabled=False), custom=_state("custom", enabled=False)))
    reader = SimpleNamespace(user_id=uuid.uuid4(), role_code="ADMINISTRATOR", groups=(), organization_id=None)
    answer = features.enabled_map(reader)
    assert answer["ai"] is False and answer["ai-assistant"] is False
    assert answer["custom"] is False
    assert answer["maps"] is True
    assert features.is_enabled("no-such-flag", reader) is True
    assert features.globally_enabled("ai-documents") is False


def test_enabled_map_looks_up_groups_only_when_a_flag_targets_one(flags, monkeypatch):
    looked: list[object] = []
    monkeypatch.setattr(features, "_group_ids", lambda uid: looked.append(uid) or ("g-1",))
    reader = SimpleNamespace(user_id="u", role_code="VIEWER", groups=(), organization_id=None)
    features.enabled_map(reader)
    assert looked == []
    flags.set(_all_on(maps=_state("maps", rollout_percentage=0, target_group_ids=("g-1",))))
    assert features.enabled_map(reader)["maps"] is True
    assert looked == ["u"]


def test_require_raises_the_documented_error(flags):
    flags.off("maps")
    with pytest.raises(FeatureDisabledError) as caught:
        features.require("maps")
    assert caught.value.status_code == 404
    assert caught.value.to_dict()["feature"] == "maps"
    features.require("calendar")


def test_state_on_with_no_row_gates_nothing():
    assert features.state_on(None) is True


# ── Cache ────────────────────────────────────────────────────────────────


def test_the_snapshot_is_cached_until_the_generation_moves(monkeypatch):
    reads: list[int] = []
    generation = {"value": 1}
    monkeypatch.setattr(features, "_read_rows", lambda: reads.append(1) or {"k": _state("k")})
    monkeypatch.setattr("src.core.cache.generations", lambda *names: {features.DATASET: generation["value"]})
    monkeypatch.setattr(features, "_snapshot", None)

    features.snapshot()
    features.snapshot()
    assert len(reads) == 1
    generation["value"] = 2
    features.snapshot()
    assert len(reads) == 2


def test_the_snapshot_expires_after_the_local_ttl(monkeypatch):
    reads: list[int] = []
    monkeypatch.setattr(features, "_read_rows", lambda: reads.append(1) or {})
    monkeypatch.setattr("src.core.cache.generations", lambda *names: {features.DATASET: 0})
    monkeypatch.setattr(features, "_snapshot", None)
    features.snapshot()
    monkeypatch.setattr(features, "_snapshot_at", features._snapshot_at - features.LOCAL_TTL - 1)
    features.snapshot()
    assert len(reads) == 2


def test_an_unreachable_database_keeps_the_last_answer_or_gates_nothing(monkeypatch):
    def down():
        raise RuntimeError("database is down")

    monkeypatch.setattr(features, "_read_rows", down)
    monkeypatch.setattr("src.core.cache.generations", lambda *names: {features.DATASET: 0})
    monkeypatch.setattr(features, "_snapshot", None)
    assert features.snapshot() == {}
    kept = {"k": _state("k", enabled=False)}
    monkeypatch.setattr(features, "_snapshot", kept)
    monkeypatch.setattr(features, "_snapshot_at", 0.0)
    assert features.snapshot() is kept


def test_invalidate_drops_the_local_copy_and_bumps_the_generation(monkeypatch):
    bumped: list[str] = []
    monkeypatch.setattr("src.core.cache.bump", lambda *names: bumped.extend(names))
    monkeypatch.setattr(features, "_snapshot", {"k": _state("k")})
    features.invalidate()
    assert features._snapshot is None
    assert bumped == [features.DATASET]


# ── Jobs and the live channel ────────────────────────────────────────────


def test_jobs_are_skipped_while_their_feature_is_off(flags):
    assert features.job_allowed("analytics.customer-health") is True
    flags.off("customer-health")
    assert features.job_allowed("analytics.customer-health") is False
    assert features.job_allowed("some.unowned-job") is True


def test_the_outbound_webhook_action_is_skipped_while_webhooks_are_off(flags):
    from src.services.automation import workflows

    flags.off("webhooks")
    outcome = workflows._webhook(None, rule=None, match=None, config={"url": "https://example.invalid/hook"})
    assert outcome.startswith("skipped")


def test_the_scheduler_and_record_triggers_do_nothing_while_workflows_are_off(flags):
    from src.services.automation import graph as automation_graph

    flags.off("workflows")
    assert automation_graph.run_due(None) == {"scheduled": 0, "resumed": 0}
    assert automation_graph.on_record_write(None, None, None, set(), created=True) == 0


def test_document_ingest_waits_while_the_feature_is_off(flags):
    from src.services.knowledge import ingest as knowledge_ingest

    flags.off("ai-documents")
    assert knowledge_ingest.run(uuid.uuid4()) is None


def test_live_messages_are_filtered_per_reader():
    assert features.live_allowed("notification", {"chat": False}) is True
    assert features.live_allowed("typing", {"chat": False}) is False
    assert features.live_allowed("typing", {"chat": True}) is True
    assert features.live_allowed("notification", {"live-updates": False}) is False


class _Socket:
    def __init__(self):
        self.sent: list[str] = []
        self.closed = False

    def send(self, message):
        self.sent.append(message)

    def close(self):
        self.closed = True


def test_a_gated_socket_drops_switched_off_messages_and_closes_when_live_goes_off(flags):
    reader = SimpleNamespace(user_id="u", role_code="VIEWER", groups=(), organization_id=None)
    socket = _Socket()
    gated = features.GatedSocket(socket, reader)

    gated.send(json.dumps({"type": "typing"}))
    gated.send("not json")
    assert len(socket.sent) == 2
    assert gated.accepts_frame('{"type":"presence"}') is True

    flags.off("chat")
    gated.send(json.dumps({"type": "typing"}))
    gated.send(json.dumps({"type": "notification"}))
    assert [json.loads(m)["type"] for m in socket.sent[2:]] == ["notification"]
    assert gated.accepts_frame('{"type":"presence"}') is False
    assert gated.accepts_frame("pong") is True

    flags.off("live-updates")
    gated.send(json.dumps({"type": "features.changed"}))
    assert json.loads(socket.sent[-1])["type"] == "features.changed"
    assert socket.closed is True
    socket.closed = False
    gated.send(json.dumps({"type": "notification"}))
    assert socket.closed is True


# ── Admin screen data ────────────────────────────────────────────────────


def test_controls_lists_what_a_flag_takes_away():
    controls = service._controls("time-tracking")
    assert "/time" in controls["routes"]
    assert any(row["url"] == "/api/time/timer" for row in controls["endpoints"])
    assert service._controls("workflows")["dependents"] == ["workflow-canvas", "webhooks"]
    assert service._controls("installation-own")["endpoints"] == []


def test_the_catalogue_is_internally_consistent():
    assert "mobile-layout" in RETIRED
    assert all(feature.key not in RETIRED for feature in FEATURES)
    owners = features.endpoint_owners()
    assert owners["/api/time/timer"] == "time-tracking"
    assert owners["/admin/flags"] is None


# ── The frontend agrees ──────────────────────────────────────────────────


def _frontend_features() -> str:
    return (REPO / "frontend/src/settings/features.ts").read_text(encoding="utf-8")


def test_every_frontend_feature_key_is_in_the_catalogue():
    source = _frontend_features()
    block = source[source.index("export const FEATURES = {"):source.index("} as const;")]
    keys = set(re.findall(r':\s*"([a-z0-9-]+)"', block))
    assert keys, "no keys parsed from features.ts"
    assert keys == set(FEATURES_BY_KEY), sorted(keys ^ set(FEATURES_BY_KEY))


def test_the_frontend_route_map_matches_the_catalogue():
    source = _frontend_features()
    block = source[source.index("export const ROUTE_FLAGS"):]
    block = block[:block.index("};")]
    frontend = dict(re.findall(r'"(/[^"]*)":\s*"([a-z0-9-]+)"', block))
    catalogue = {route: feature.key for feature in FEATURES for route in feature.routes}
    assert frontend == catalogue


# ── Through the database ─────────────────────────────────────────────────


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    from tests.conftest import persona_claims

    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"ff-{username}"),
    )
    return {"Authorization": f"Bearer ff-{username}"}


@pytest.fixture()
def temp_flag():
    """A flag of the test's own, removed afterwards — never a shared one."""
    from sqlalchemy import delete

    from src.core.db import session_scope
    from src.models.platform import FeatureFlag

    key = f"test-ff-{uuid.uuid4().hex[:8]}"
    yield key
    with session_scope() as session:
        session.execute(delete(FeatureFlag).where(FeatureFlag.key == key))
    features.invalidate()


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
        from src.models.platform import AuditLog
        from src.core.clock import now as clock_now

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
    monkeypatch.setattr(features, "_group_ids", lambda uid: ())
    answer = client.get(
        f"{PREFIX}/admin/flags/preview?role=VIEWER&group=Field%20ops&organization_id={org}", headers=headers,
    ).get_json()
    assert answer["features"]["maps"] is True
    assert answer["features"]["chat"] is True
