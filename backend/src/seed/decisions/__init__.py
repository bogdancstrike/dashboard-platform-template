"""Seed data for Time & decisions: time, timesheets, approvals, SLA policies, forms."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "personas": ("RNG_SEED", "NOTES", "_personas", "_system", "_decide"),
    "approvals": ("populate_approvals",),
    "time_entries": ("populate_time", "_holidays"),
    "sla_policies": ("populate_sla", "SUPPORT_FIELDS", "EQUIPMENT_FIELDS", "PARTNER_FIELDS"),
    "intake_forms": ("populate_forms", "populate"),
})
