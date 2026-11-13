"""A dashboard's payload and a widget's geometry, checked."""

from __future__ import annotations

from typing import Any

from src.core import sharing
from src.core.errors import ValidationError
from src.models.personal import Dashboard, DashboardWidget
from src.services.analytics.dashboards.widget_catalogue import (
    SHARE_PERMISSION,
    WIDGET_KINDS,
)
from src.services.analytics.dashboards.widget_config import _config
from src.services.analytics.dashboards.widget_sizes import (
    DEFAULT_SIZES,
    MAX_HEIGHT,
    MIN_HEIGHT,
)


def _validated(
    payload: dict[str, Any], *, principal, partial: bool, existing: Dashboard | None = None
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The dashboard must be a JSON object.")

    out: dict[str, Any] = {}

    if not partial or "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError("A dashboard needs a name people will recognise.")
        out["name"] = name[:200]

    if "description" in payload:
        description = payload.get("description")
        out["description"] = str(description).strip()[:2000] if description else None

    if "icon" in payload:
        icon = payload.get("icon")
        out["icon"] = str(icon).strip()[:48] if icon else None

    if not partial or "scope" in payload:
        out["scope"] = sharing.scope_of(
            payload.get("scope"),
            current=existing.scope if existing else "PRIVATE",
            principal=principal,
            share_permission=SHARE_PERMISSION,
        )

    if "is_home" in payload:
        out["is_home"] = bool(payload.get("is_home"))
    elif not partial:
        out["is_home"] = False

    if "filters" in payload:
        filters = payload.get("filters")
        if filters is not None and not isinstance(filters, dict):
            raise ValidationError("filters must be an object.")
        out["filters"] = filters

    if not partial or "member_ids" in payload:
        out["member_ids"] = sharing.requested_members(payload)

    return out


def _validated_widget(
    payload: dict[str, Any],
    *,
    principal,
    partial: bool,
    columns: int,
    existing: DashboardWidget | None = None,
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The widget must be a JSON object.")

    out: dict[str, Any] = {}

    if not partial or "kind" in payload:
        kind = str(payload.get("kind") or "").strip().upper()
        if kind not in WIDGET_KINDS:
            raise ValidationError(
                "That is not a widget this platform can draw.",
                details={"kind": kind, "allowed": sorted(WIDGET_KINDS)},
            )
        out["kind"] = kind

    kind = out.get("kind") or (existing.kind if existing else "")

    if not partial or "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title:
            raise ValidationError("A widget needs a title, so a reader knows what it answers.")
        out["title"] = title[:200]

    if "subtitle" in payload:
        subtitle = payload.get("subtitle")
        out["subtitle"] = str(subtitle).strip()[:240] if subtitle else None

    if not partial or "config" in payload:
        out["config"] = _config(payload.get("config"), kind=kind, principal=principal)

    out.update(
        _geometry(payload, columns=columns, existing=existing, partial=partial, kind=kind)
    )
    return out


def _geometry(
    payload: dict[str, Any],
    *,
    columns: int,
    existing: DashboardWidget | None = None,
    partial: bool = True,
    kind: str = "",
) -> dict[str, Any]:
    """Where the card sits, checked so a grid cannot render on top of itself.

    A size the caller did not give comes from the *kind*, which is the one
    place that knows a KPI wants three columns and a heatmap wants six. A
    client that had to send sizes would be a second copy of that table.
    """
    out: dict[str, Any] = {}
    default_width, default_height = DEFAULT_SIZES.get(kind, (4, 2))

    def number(key: str, default: int) -> int:
        if key in payload:
            try:
                return int(payload[key])
            except (TypeError, ValueError) as exc:
                raise ValidationError(f"{key} must be a whole number.") from exc
        if existing is not None:
            return int(getattr(existing, key))
        return default

    width = number("width", default_width)
    height = number("height", default_height)
    x = number("x", 0)
    y = number("y", 0)

    if not 1 <= width <= columns:
        raise ValidationError(
            f"A widget is between 1 and {columns} columns wide.",
            details={"width": width, "columns": columns},
        )
    if not MIN_HEIGHT <= height <= MAX_HEIGHT:
        raise ValidationError(
            f"A widget is between {MIN_HEIGHT} and {MAX_HEIGHT} rows tall.",
            details={"height": height},
        )
    if x < 0 or y < 0:
        raise ValidationError("A widget sits at a non-negative position.")
    if x + width > columns:
        # Refused rather than clamped: a card silently narrowed on save is a
        # layout the reader did not choose and cannot undo.
        raise ValidationError(
            "That widget would hang off the right of the grid.",
            details={"x": x, "width": width, "columns": columns},
        )

    if not partial or any(key in payload for key in ("x", "y", "width", "height")):
        out.update({"x": x, "y": y, "width": width, "height": height})
    return out
