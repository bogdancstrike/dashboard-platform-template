"""Feature flags, enforced end to end (§27). — Cache."""

from __future__ import annotations

import json
import re
import uuid
from types import SimpleNamespace

from src.core import cache, features
from src.core.feature_catalogue import (
    FEATURES,
    FEATURES_BY_KEY,
    RETIRED,
)
from src.services.platform import settings as service
from tests.feature_flags_support import (  # noqa: F401
    _Socket,
    _frontend_features,
    _state,
    flags,
    temp_flag,
)
from tests.patching import patch_package


def test_the_snapshot_is_cached_until_the_generation_moves(monkeypatch):
    reads: list[int] = []
    generation = {"value": 1}
    patch_package(monkeypatch, features, "_read_rows", lambda: reads.append(1) or {"k": _state("k")})
    patch_package(monkeypatch, cache, "generations", lambda *names: {features.DATASET: generation["value"]})
    patch_package(monkeypatch, features, "_snapshot", None)

    features.snapshot()
    features.snapshot()
    assert len(reads) == 1
    generation["value"] = 2
    features.snapshot()
    assert len(reads) == 2


def test_the_snapshot_expires_after_the_local_ttl(monkeypatch):
    reads: list[int] = []
    patch_package(monkeypatch, features, "_read_rows", lambda: reads.append(1) or {})
    patch_package(monkeypatch, cache, "generations", lambda *names: {features.DATASET: 0})
    patch_package(monkeypatch, features, "_snapshot", None)
    features.snapshot()
    patch_package(monkeypatch, features, "_snapshot_at", features._snapshot_at - features.LOCAL_TTL - 1)
    features.snapshot()
    assert len(reads) == 2


def test_an_unreachable_database_keeps_the_last_answer_or_gates_nothing(monkeypatch):
    def down():
        raise RuntimeError("database is down")

    patch_package(monkeypatch, features, "_read_rows", down)
    patch_package(monkeypatch, cache, "generations", lambda *names: {features.DATASET: 0})
    patch_package(monkeypatch, features, "_snapshot", None)
    assert features.snapshot() == {}
    kept = {"k": _state("k", enabled=False)}
    patch_package(monkeypatch, features, "_snapshot", kept)
    patch_package(monkeypatch, features, "_snapshot_at", 0.0)
    assert features.snapshot() is kept


def test_invalidate_drops_the_local_copy_and_bumps_the_generation(monkeypatch):
    bumped: list[str] = []
    patch_package(monkeypatch, cache, "bump", lambda *names: bumped.extend(names))
    patch_package(monkeypatch, features, "_snapshot", {"k": _state("k")})
    features.invalidate()
    assert features._snapshot is None
    assert bumped == [features.DATASET]


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
