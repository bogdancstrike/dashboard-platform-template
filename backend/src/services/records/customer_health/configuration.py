"""Saving the scoring model, which rescores every customer."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.core.clock import now
from src.core.errors import ValidationError
from src.services.records.customer_health.recompute_job import recompute
from src.services.records.customer_health.scoring_model import (
    CONFIGURE,
    DEFAULT_THRESHOLDS,
    SIGNALS,
    _bounded,
    _merged,
    _model_dict,
    active_model,
)


def save_model(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Change weights and thresholds, validated, audited, and applied at once."""
    principal.require(CONFIGURE)
    if not isinstance(payload, dict):
        raise ValidationError("The model must be a JSON object.")
    row = active_model(session)
    before = {"weights": dict(row.weights), "thresholds": _merged(DEFAULT_THRESHOLDS, row.thresholds or {})}

    weights = dict(row.weights)
    raw_weights = payload.get("weights")
    if raw_weights is not None:
        if not isinstance(raw_weights, dict):
            raise ValidationError("weights must be an object.", details={"field": "weights"})
        for key, value in raw_weights.items():
            if key not in SIGNALS:
                raise ValidationError(f"{key} is not a signal.", details={"field": f"weights.{key}", "allowed": list(SIGNALS)})
            weights[key] = _bounded(value, f"weights.{key}", 0, 100)
        if sum(int(weights.get(key, 0)) for key in SIGNALS) <= 0:
            raise ValidationError("At least one signal must carry weight.", details={"field": "weights"})

    thresholds = _merged(DEFAULT_THRESHOLDS, row.thresholds or {})
    raw = payload.get("thresholds")
    if raw is not None:
        if not isinstance(raw, dict):
            raise ValidationError("thresholds must be an object.", details={"field": "thresholds"})
        for group, values in raw.items():
            if group not in DEFAULT_THRESHOLDS or not isinstance(values, dict):
                raise ValidationError(f"{group} is not a threshold group.", details={"field": f"thresholds.{group}"})
            for key, value in values.items():
                if key not in DEFAULT_THRESHOLDS[group]:
                    raise ValidationError(f"{group}.{key} is not a threshold.", details={"field": f"thresholds.{group}.{key}"})
                upper = 100 if group in ("bands", "tickets") else 3650
                thresholds[group][key] = _bounded(value, f"thresholds.{group}.{key}", 1, upper)
        bands = thresholds["bands"]
        if bands["at_risk"] >= bands["healthy"]:
            raise ValidationError(
                "The at-risk cut-off must be below the healthy one.",
                details={"field": "thresholds.bands.at_risk"},
            )

    if isinstance(payload.get("name"), str) and payload["name"].strip():
        row.name = payload["name"].strip()[:120]
    row.weights = weights
    row.thresholds = thresholds
    row.updated_by_id = principal.user_id
    row.updated_at = now()
    session.flush()
    audit.record(
        session, action="CONFIGURATION_CHANGE", resource_type="health_model", resource_id=row.id,
        resource_label=row.name, principal=principal,
        before=before, after={"weights": weights, "thresholds": thresholds},
        message="changed the customer health model",
    )
    result = recompute(session, principal=principal, notify=False)
    return {**_model_dict(row, principal), "recomputed": result}
