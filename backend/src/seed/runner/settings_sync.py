"""Repairs for system settings."""

from __future__ import annotations


def sync_settings(session) -> dict[str, int]:
    """Bring each setting's *declaration* up to date, keeping chosen values.

    The fourth of these repairs, and the one an ordinary deploy needs: the
    catalogue gains a setting, or an existing one gains a type and a range, and
    seeding refuses to touch a populated database. Without this the demo kept
    twenty settings declared as `string` with no options — so the settings
    screen rendered every one as a text box and the declared type was
    decoration.

    What it writes: the label, description, type, options, secrecy and the
    **default**. What it leaves alone: the `value` somebody chose — with one
    exception. When a type or its choices change, a stored value can stop being
    valid for its own declaration (`"25"` as a string is not `25` in a list of
    integers), and a setting the editor refuses is a screen reporting its own
    data as invalid. Those are reset to the new default, and counted
    separately so the output says how many.

    Idempotent, so it can run on every deploy.
    """
    from sqlalchemy import select as _select

    from src.models.platform import SystemSetting
    from src.seed import catalog

    added = updated = reset = 0
    for key, category, label, value_type, default, description, options in (
        catalog.SYSTEM_SETTINGS
    ):
        row = session.scalar(_select(SystemSetting).where(SystemSetting.key == key))
        if row is None:
            session.add(
                SystemSetting(
                    key=key,
                    category=category,
                    label=label,
                    description=description,
                    value={"value": default},
                    default_value={"value": default},
                    value_type=value_type,
                    options=options or None,
                    is_secret=bool(options.get("secret")),
                    requires_restart=bool(options.get("restart")),
                )
            )
            added += 1
            continue

        changed = False
        for attribute, value in (
            ("category", category),
            ("label", label),
            ("description", description),
            ("value_type", value_type),
            ("options", options or None),
            ("is_secret", bool(options.get("secret"))),
            ("requires_restart", bool(options.get("restart"))),
            ("default_value", {"value": default}),
        ):
            if getattr(row, attribute) != value:
                setattr(row, attribute, value)
                changed = True

        if not _fits(row, options, value_type):
            row.value = {"value": default}
            reset += 1
            changed = True
        if changed:
            updated += 1

    session.flush()
    return {"added": added, "updated": updated, "reset": reset}


def _fits(row, options: dict, value_type: str) -> bool:
    """Whether a stored value is still valid for its own declaration."""
    current = row.value.get("value") if isinstance(row.value, dict) else row.value
    if value_type == "boolean":
        return isinstance(current, bool)
    if value_type in ("integer", "duration"):
        if not isinstance(current, int) or isinstance(current, bool):
            return False
        low, high = options.get("minimum"), options.get("maximum")
        if low is not None and current < int(low):
            return False
        return not (high is not None and current > int(high))
    if value_type == "choice":
        choices = options.get("choices") or []
        return not choices or current in choices
    return True
