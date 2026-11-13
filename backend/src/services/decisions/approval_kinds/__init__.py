"""The built-in kinds of approval: access, held-back changes, report publishing.
See docs/architecture/backend/approval-kinds.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "access_requests": (
        "ACCESS_DECIDER", "CHANGE_DECIDER", "OPERATORS", "_access_group", "_apply_access",
        "_describe_access", "request_access",
    ),
    "change_requests": (
        "_matches", "intercept", "_apply_change", "_describe_change", "_rule_body", "_field_body",
        "rules",
    ),
    "change_rules": ("_checked_rule", "save_rule", "delete_rule"),
    "report_publishing": ("_apply_report", "request_publish", "_describe_report"),
})
