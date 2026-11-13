"""Customer health (§12): a weighted model from tickets, orders and usage, with trend.
See docs/architecture/backend/customer-health.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "scoring_model": (
        "VIEW", "CONFIGURE", "BANDS", "BAND_LABELS", "SIGNALS", "SIGNAL_LABELS", "DEFAULT_WEIGHTS",
        "DEFAULT_THRESHOLDS", "CLOSED_TICKETS", "VOID_ORDERS", "JOB_CODE", "active_model",
        "model_view", "_model_dict", "_bounded", "_merged",
    ),
    "signals": ("Inputs", "band_for", "_clamp", "_days_since", "_trend"),
    "scoring": ("score",),
    "inputs": ("gather",),
    "recompute_job": ("_daily_job", "recompute", "_scores_on", "_alert_drops"),
    "reads": ("customer", "_health_dict", "portfolio"),
    "configuration": ("save_model",),
})
