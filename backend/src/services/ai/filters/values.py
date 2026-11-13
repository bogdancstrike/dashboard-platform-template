"""Values coerced to what a field accepts."""

from __future__ import annotations

import difflib
import re
import uuid
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import or_, select

from src.core.query import Field
from src.services.ai.filters.vocabulary import _VALUELESS, DATE_FORMAT
from src.services.records import explorer


def _flat(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        out: list[Any] = []
        for item in value:
            out.extend(_flat(item) if isinstance(item, (list, tuple)) else [item])
        return [v for v in out if v is not None and v != ""]
    if isinstance(value, str) and "," in value and not re.match(r"^\d{4}-\d\d-\d\d", value):
        return [part.strip() for part in value.split(",") if part.strip()]
    return [value]


def _choice(value: Any, choices: tuple[str, ...]) -> str | None:
    if not choices:
        return str(value)
    wanted = re.sub(r"[\s\-]+", "_", str(value).strip()).upper()
    for choice in choices:
        if choice.upper() == wanted:
            return choice
    close = difflib.get_close_matches(wanted, [c.upper() for c in choices], n=1, cutoff=0.8)
    if close:
        return next(c for c in choices if c.upper() == close[0])
    return None


def _boolean(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in ("true", "yes", "1", "y", "on"):
        return True
    if text in ("false", "no", "0", "n", "off"):
        return False
    return None


def _number(value: Any) -> int | float | None:
    try:
        number = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return int(number) if number.is_integer() else number


_RELATIVE = re.compile(r"^(?:@?today|@?now)?\s*([+-])\s*(\d+)\s*([dwmy])$")


def _moment(value: Any, *, today: datetime) -> str | None:
    text = str(value).strip().lower()
    base = today.replace(hour=0, minute=0, second=0, microsecond=0)
    if text in ("today", "@today"):
        return base.strftime(DATE_FORMAT)
    if text in ("now", "@now"):
        return today.strftime(DATE_FORMAT)
    if text in ("tomorrow", "@tomorrow"):
        return (base + timedelta(days=1)).strftime(DATE_FORMAT)
    if text in ("yesterday", "@yesterday"):
        return (base - timedelta(days=1)).strftime(DATE_FORMAT)
    match = _RELATIVE.match(text)
    if match:
        sign, amount, unit = match.groups()
        days = int(amount) * {"d": 1, "w": 7, "m": 30, "y": 365}[unit]
        return (base + timedelta(days=days if sign == "+" else -days)).strftime(DATE_FORMAT)
    raw = str(value).strip().replace("T", " ").replace("Z", "")
    for fmt in (DATE_FORMAT, "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw[: len(datetime(2000, 1, 1).strftime(fmt))], fmt).strftime(DATE_FORMAT)
        except ValueError:
            continue
    return None


def _references(session, spec: Field, values: list[Any], *, principal) -> list[str]:
    """Ids for the people or records a question *named*."""
    target = explorer.references_of(spec)
    ids: list[str] = []
    for value in values:
        text = str(value).strip()
        if text.lower() in ("@me", "me", "myself", "mine", "i"):
            ids.append(str(principal.user_id))
            continue
        try:
            ids.append(str(uuid.UUID(text)))
            continue
        except ValueError:
            pass
        if not target or session is None:
            continue
        if target == "user":
            from src.models.identity import User

            rows = session.scalars(
                select(User.id).where(or_(User.full_name.ilike(f"%{text}%"), User.username.ilike(text),
                                          User.email.ilike(text))).limit(5)
            ).all()
        else:
            ref = explorer.resources().get(target)
            if ref is None or not principal.can(ref.permission):
                continue
            column = getattr(ref.model, ref.title_field, None)
            if column is None:
                continue
            exact = session.scalars(select(ref.model.id).where(column.ilike(text)).limit(5)).all()
            if exact:
                ids.extend(str(r) for r in exact)
                continue
            clauses = [column.ilike(f"%{text}%")]
            for extra in ("code", "reference", "name"):
                col = getattr(ref.model, extra, None)
                if col is not None and extra != ref.title_field:
                    clauses.append(col.ilike(text))
            rows = session.scalars(select(ref.model.id).where(or_(*clauses)).limit(5)).all()
        ids.extend(str(r) for r in rows)
    return list(dict.fromkeys(ids))


def coerce_values(session, spec: Field, op: str, raw: Any, *, principal, today: datetime) -> list[Any] | None:
    """The value list for a rule, or None when nothing usable is left."""
    if op in _VALUELESS:
        return []
    values = _flat(raw)
    if spec.kind == "enum":
        values = [c for v in values if (c := _choice(v, spec.choices)) is not None]
    elif spec.kind == "bool":
        values = [b for v in values if (b := _boolean(v)) is not None]
    elif spec.kind == "number":
        values = [n for v in values if (n := _number(v)) is not None]
    elif spec.kind == "datetime":
        values = [m for v in values if (m := _moment(v, today=today)) is not None]
    elif spec.kind == "uuid":
        values = _references(session, spec, values, principal=principal)
    else:
        values = [str(v) for v in values]
    values = list(dict.fromkeys(values))
    if not values:
        return None
    if op == "between":
        return values[:2] if len(values) >= 2 else None
    if op in ("in", "not_in"):
        return [values]
    return [values[0]]
