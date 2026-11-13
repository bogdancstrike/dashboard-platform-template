"""Workflows as node graphs (§49): shape, validation, the walking engine, storage, triggers and waits.
See docs/architecture/backend/automation-graph.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "kinds": (
        "MAX_WAIT_MINUTES", "TRIGGERS", "FLOW", "PORTS", "_ports_for", "APPROVAL_KIND",
        "catalogue_extras",
    ),
    "shape": (
        "PERMISSION", "MAX_NODES", "MAX_EDGES", "STATS_RUNS", "_NODE_ID", "_ACTIVE", "normalize",
        "_number", "trigger_of", "_by_id", "_outgoing", "_resource", "assignable_field",
    ),
    "cron": ("_cron", "_CRON_RANGES", "_cron_values", "_cron_int", "cron_matches", "cron_due"),
    "cleaning": ("clean_action", "_clean_flow", "_clean_update", "_clean_create"),
    "checks": ("problems", "_check_trigger", "_check_tree", "_reachable", "_cycle"),
    "legacy": (
        "_ROW", "from_legacy", "linear", "apply_form_edit", "derive_legacy", "describe_trigger",
    ),
    "walk": ("Walk", "_matches_for", "_filter", "resource_for_principal"),
    "flow": ("_flow", "_ask"),
    "engine": ("_walk", "_run_action"),
    "runs": ("evaluate",),
    "preview": ("trace", "samples"),
    "storage": (
        "ensure", "_rule", "_require_own", "detail", "save_draft", "publish", "_install",
        "node_stats",
    ),
    "editing": ("restore", "create_with_graph", "after_form_edit", "check_form_edit"),
    "triggers": ("on_record_write", "_event_matches", "fire_webhook"),
    "waits": ("resume", "_resume_on_decision", "pending_waits"),
    "scheduler": ("run_due", "run_scheduler", "_LAST_CATCH_UP", "CATCH_UP_SECONDS", "catch_up"),
})
