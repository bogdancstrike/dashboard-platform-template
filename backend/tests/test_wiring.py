"""The composition root connects every built-in feature to the hooks it serves."""

from __future__ import annotations

from src.core.events import Hook
from src.services import analytics_jobs, approvals, notifications, record_writes


def test_every_extension_point_has_its_built_in_subscribers():
    assert sorted(approvals.providers()) == ["access", "automation", "change", "report", "timesheet"]
    assert sorted(analytics_jobs._RUNNERS) == ["analytics.anomaly-watch", "analytics.customer-health"]
    assert len(notifications.badges.handlers) == 2
    for hook in (record_writes.update_requested, record_writes.derived, record_writes.written):
        assert len(hook.handlers) == 1, hook


def test_a_hook_calls_in_order_answers_first_and_forgets():
    hook, calls = Hook("demo"), []
    first = hook.connect(lambda x: calls.append(("a", x)))
    hook.connect(first)  # idempotent
    hook.connect(lambda x: x * 2)
    assert hook.emit(3) == [None, 6] and calls == [("a", 3)]
    assert hook.first(4) == 8
    hook.disconnect(first)
    assert hook.handlers and "demo" in repr(hook)
    assert Hook("empty").first() is None
