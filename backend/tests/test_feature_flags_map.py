"""Feature flags, enforced end to end (§27). — The map."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from src.core import features
from src.core.feature_catalogue import (
    CORE_ENDPOINTS,
    FEATURES,
    FEATURES_BY_KEY,
)
from src.core.features import FeatureDisabledError
from src.services.platform import settings as service
from tests.feature_flags_support import (  # noqa: F401
    ENTRIES,
    FLAGGED,
    PREFIX,
    _all_on,
    _signed_in,
    _state,
    _url,
    flags,
    temp_flag,
)
from tests.patching import patch_package


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
        patch_package(monkeypatch, features, "_caller", lambda: SimpleNamespace(
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

    patch_package(monkeypatch, features, "_caller", lambda: admin)
    assert client.get(f"{PREFIX}/api/maps/catalog").status_code == 200
    patch_package(monkeypatch, features, "_caller", lambda: viewer)
    assert client.get(f"{PREFIX}/api/maps/catalog").get_json()["error"] == "feature_disabled"


def test_a_bad_token_reads_as_anonymous_to_the_gate(monkeypatch):
    def boom(**_):
        raise RuntimeError("bad token")

    monkeypatch.setattr("src.core.auth.caller.principal_from_request", boom)
    assert features._caller() is None


def test_evaluate_off_means_off_for_everybody():
    assert features.evaluate(enabled=False, key="k", rollout=100, user_ids=["u"], user_id="u") is False


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
    assert features.evaluate(enabled=True, key="k", rollout=0, **targets, **reader) is True
    assert features.evaluate(enabled=True, key="k", rollout=0, **targets) is False


def test_evaluate_percentage_is_stable_and_proportional():
    users = [uuid.UUID(int=i) for i in range(400)]
    first = [features.evaluate(enabled=True, key="k", rollout=25, user_id=u) for u in users]
    again = [features.evaluate(enabled=True, key="k", rollout=25, user_id=u) for u in users]
    assert first == again
    assert 60 < sum(first) < 140
    assert features.evaluate(enabled=True, key="k", rollout=25, user_id=None) is False
    assert features.evaluate(enabled=True, key="k", rollout=100) is True


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
    patch_package(monkeypatch, features, "_group_ids", lambda uid: looked.append(uid) or ("g-1",))
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
