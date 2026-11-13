"""Workflow rules (§49): when a record matches, do something — the action catalogue, evaluation,
and the rule CRUD the list page and the form editor use. The node-graph engine is
`automation.graph`. See docs/architecture/backend/automation.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "actions": (
        "PERMISSION", "WEBHOOK_TIMEOUT_SECONDS", "SEVERITIES", "_PLACEHOLDER", "Match", "Action",
        "_text", "_owner_principal", "_recipient_ids", "_next_task_reference",
    ),
    "messages": ("_notify", "_email"),
    "record_actions": ("_task", "_update_field", "_assign", "_create_record"),
    "webhook": ("_webhook", "_NoRedirect", "_webhook_url"),
    "registry": ("ACTIONS", "FORM_ACTIONS", "catalogue", "_recipient_config"),
    "matching": (
        "MAX_MATCHES", "MAX_FIRES", "SAMPLE_SIZE", "_matches", "_reason", "_cooldown_ledger",
        "_remember", "_tally",
    ),
    "queries": ("list_rules", "_counts", "get", "_cooling_down", "runs"),
    "commands": ("evaluate", "create", "update", "remove", "run_now"),
    "validation": ("_validated", "_validated_actions", "_cron", "_whole", "_rule", "_require_own"),
    "serializers": ("_serialize", "_can_edit", "serialize_run", "_audit_state"),
})
