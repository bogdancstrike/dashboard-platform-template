"""None"""

from __future__ import annotations

from typing import Any

from src.core.cleaners import bounded_name, json_object, object_or_null, text
from src.core.errors import ValidationError
from src.core.shared_fields import members_step, scope_step
from src.core.validation import Field, Schema
from src.models.personal import Report
from src.services.analytics import analysis
from src.services.analytics.reports.access import SHARE_PERMISSION, VISUALIZATIONS
from src.services.analytics.reports.serializers import (
    _stored_dimensions,
    _stored_measures,
)
from src.services.records.explorer import resource_for


def definition(row: Report) -> dict[str, Any]:
    """The analysis payload a stored report stands for."""
    return {
        "resource_type": row.resource_type,
        "dimensions": _stored_dimensions(row),
        "measures": _stored_measures(row),
        "filters": row.filters or {},
        "condition_tree": row.condition_tree,
        "period": row.period or "all_time",
    }


def _resource(out: dict[str, Any], ctx) -> None:
    ctx.extra["resource"] = resource_for(
        ctx.value("resource_type", inherit=True), principal=ctx.principal
    )


def _period(raw: Any, ctx) -> Any:
    # Validated by the same function that will resolve it at run time, so a
    # report cannot be saved with a period the compiler would refuse.
    analysis.period_window(raw)
    return raw


def _visualization(raw: Any, ctx) -> str:
    visualization = str(raw).strip().lower()
    if visualization not in VISUALIZATIONS:
        raise ValidationError(
            "Unknown visualization.",
            details={"visualization": visualization, "allowed": sorted(VISUALIZATIONS)},
        )
    return visualization


def _order(raw: Any, ctx) -> str:
    order = str(raw or "desc").lower()
    if order not in ("asc", "desc"):
        raise ValidationError("order must be asc or desc", details={"field": "order"})
    return order


def _schedule(raw: Any, ctx) -> str | None:
    schedule = str(raw or "").strip() or None
    if schedule:
        # Setting a schedule is the scheduled-reports feature (§27); clearing
        # one is always allowed, so a switched-off feature can still be wound down.
        from src.core import features

        features.require("report-scheduling", ctx.principal)
    return schedule


#: `is_favorite` is accepted but deliberately *not* written here: it is no
#: longer a column. See `_apply_favorite`, which puts it in the one store (§38).
_SCHEMA = Schema(
    [
        _resource,
        Field("name", bounded_name()),
        Field("description", text(empty=None), sparse=True),
        Field("resource_type", lambda raw, ctx: ctx.extra["resource"].key),
        scope_step(SHARE_PERMISSION),
        Field("dimensions", lambda raw, ctx: _dimensions(raw or [])),
        Field("metrics", lambda raw, ctx: _metrics(raw or [])),
        Field("filters", json_object("filters must be an object."), sparse=True),
        Field("condition_tree", object_or_null("condition_tree must be an object or null."),
              sparse=True),
        Field("period", _period, default="last_30_days", inherit=True),
        Field("visualization", _visualization, default="bar", inherit=True),
        Field("sort", text(empty=None), sparse=True),
        Field("order", _order, sparse=True),
        Field("schedule", _schedule, sparse=True),
        members_step(SHARE_PERMISSION),
    ],
    not_object="The report must be a JSON object.",
    unknown="Unknown report field.",
    extra_allowed={"scope", "member_ids", "group_by", "is_favorite"},
)


def _validated(
    payload: Any, *, principal, partial: bool, existing: Report | None = None,
) -> dict[str, Any]:
    return _SCHEMA.validate(payload, principal=principal, partial=partial, existing=existing)


def _dimensions(raw: Any) -> list[str]:
    """`[{"field": "placed_at", "granularity": "month"}]` → `["placed_at:month"]`."""
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("dimensions must be an array.")
    if len(raw) > 2:
        raise ValidationError("A report groups by at most two fields.")
    out: list[str] = []
    for entry in raw:
        if isinstance(entry, str):
            out.append(entry)
            continue
        if not isinstance(entry, dict) or not entry.get("field"):
            raise ValidationError("Each dimension needs a field.")
        granularity = str(entry.get("granularity") or "")
        out.append(f"{entry['field']}:{granularity}" if granularity else str(entry["field"]))
    return out


def _metrics(raw: Any) -> list[str]:
    """`[{"aggregation": "sum", "field": "total"}]` → `["sum:total"]`."""
    if not isinstance(raw, (list, tuple)):
        raise ValidationError("metrics must be an array.")
    if len(raw) > 4:
        raise ValidationError("A report computes at most four measures.")
    out: list[str] = []
    for entry in raw:
        if isinstance(entry, str):
            out.append(entry)
            continue
        if not isinstance(entry, dict):
            raise ValidationError("Each metric must be an object or a string.")
        aggregation = str(entry.get("aggregation") or entry.get("kind") or "count").lower()
        field = str(entry.get("field") or "")
        out.append(f"{aggregation}:{field}" if field else aggregation)
    return out or ["count"]
