"""System settings: list and change."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import audit
from src.core.clock import iso
from src.core.errors import ValidationError
from src.core.repository import found_or_404
from src.models.platform import SystemSetting
from src.services.platform.settings.values import _coerced, _drifted, _setting, _visible

#: Reading the configuration and changing it are the same privilege: a setting
#: names an SMTP host and a retention period, and a reader who may see those
#: is a reader who is already trusted with them.
SETTINGS_PERMISSION = "settings.manage"


#: Flags are their own privilege because turning one on ships a feature.
FLAGS_PERMISSION = "flags.manage"


#: What a value may be. Declared per row and read by the form, so a new
#: setting needs no frontend change — and a type the form cannot render is
#: refused here rather than drawn as a textarea.
VALUE_TYPES = ("string", "integer", "boolean", "choice", "json", "duration")


MAX_KEY = 96


MAX_LABEL = 200


def settings(session, args, *, principal) -> dict[str, Any]:
    """Every setting, grouped by category, with what it was shipped as.

    Grouped on the server rather than in the browser because the *order* of
    the categories is a decision — general before security before retention —
    and a page that sorted them alphabetically would put "advanced" first.
    """
    principal.require(SETTINGS_PERMISSION)
    statement = select(SystemSetting).order_by(
        SystemSetting.category.asc(), SystemSetting.label.asc()
    )

    category = str((args or {}).get("category") or "").strip()
    if category:
        statement = statement.where(SystemSetting.category == category)

    term = str((args or {}).get("q") or "").strip().lower()
    rows = session.scalars(statement).all()
    if term:
        rows = [
            row
            for row in rows
            if term in row.label.lower()
            or term in row.key.lower()
            or term in (row.description or "").lower()
        ]

    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(row.category, []).append(_setting(row))

    return {
        "groups": [
            {"key": key, "label": key.replace("_", " ").title(), "items": items}
            for key, items in groups.items()
        ],
        "total": len(rows),
        "categories": _categories(session),
        "value_types": list(VALUE_TYPES),
        # How many differ from what the platform ships with — the number an
        # administrator wants before a deploy, and the reason the default is
        # stored beside the value at all.
        "changed": sum(1 for row in rows if _drifted(row)),
        "restart_pending": sum(
            1 for row in rows if row.requires_restart and _drifted(row)
        ),
    }


def _categories(session) -> list[dict[str, Any]]:
    rows = session.execute(
        select(SystemSetting.category, func.count()).group_by(SystemSetting.category)
    ).all()
    return [
        {"key": row[0], "label": str(row[0]).replace("_", " ").title(), "count": int(row[1])}
        for row in sorted(rows, key=lambda item: item[0])
    ]


def update_setting(session, key: Any, payload: dict[str, Any], *, principal):
    """Change one setting.

    One key per request on purpose: the audit row then names exactly what
    changed, and a refusal names the setting it refused. A bulk write of a
    configuration document audits as "the settings changed", which is the least
    useful thing an audit trail can say.
    """
    principal.require(SETTINGS_PERMISSION)
    row = found_or_404(
        session.scalar(select(SystemSetting).where(SystemSetting.key == str(key or ""))),
        "That setting does not exist.",
        details={"key": str(key or "")},
    )

    data = payload if isinstance(payload, dict) else {}
    if "value" not in data and not data.get("reset"):
        raise ValidationError("Send a value, or ask for a reset.")

    before = {"value": _visible(row), "updated_at": iso(row.updated_at)}
    if data.get("reset"):
        row.value = row.default_value
    else:
        row.value = {"value": _coerced(row, data["value"])}
    row.updated_by_id = getattr(principal, "user_id", None)
    session.flush()

    audit.record(
        session,
        action="SETTING_CHANGE",
        resource_type="system_setting",
        resource_id=row.id,
        resource_label=row.label,
        principal=principal,
        before=before,
        after={"value": _visible(row), "updated_at": iso(row.updated_at)},
        message=(
            f"reset {row.label} to its default"
            if data.get("reset")
            else f"changed {row.label}"
        ),
    )
    return _setting(row)
