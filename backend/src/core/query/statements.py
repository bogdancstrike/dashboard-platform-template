"""Filters and sort applied to a statement; counts and facets."""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, func, or_, select

from src.core.errors import ValidationError
from src.core.query.fields import MAX_FILTER_CHARS, FieldSet
from src.core.query.predicates import _default_predicate, build_predicate
from src.core.query.values import _as_text, _moment, _number


def _blank_argument(raw: Any) -> bool:
    """No value at all — as a missing key, an empty string or an empty list.

    A cleared multi-select sends `[]`, which means "do not narrow by this",
    not "narrow by nothing".
    """
    if raw is None:
        return True
    if isinstance(raw, (list, tuple, set)):
        return not any(str(value).strip() for value in raw)
    return not str(raw).strip()


def apply_filters(stmt: Select, args, spec: FieldSet) -> Select:
    """Narrow `stmt` by every recognised query parameter in `args`."""
    for field_spec in spec.fields:
        if not field_spec.filterable:
            continue
        name = field_spec.name
        raw = args.get(name)
        if not _blank_argument(raw):
            predicate = _default_predicate(field_spec, raw)
            if predicate is not None:
                stmt = stmt.where(predicate)

        if field_spec.kind in ("number", "datetime"):
            convert = _number if field_spec.kind == "number" else _moment
            low = args.get(f"{name}_min") or args.get(f"{name}_from")
            high = args.get(f"{name}_max") or args.get(f"{name}_to")
            if low:
                stmt = stmt.where(field_spec.column >= convert(_as_text(low), name=name))
            if high:
                stmt = stmt.where(field_spec.column <= convert(_as_text(high), name=name))

    # Explicit operators, e.g. `?title__not=draft`. Applied after the plain
    # filters so one field can carry both: "contains X but not Y" is among the
    # most common things anybody wants to ask.
    for key in list(args.keys()):
        if "__" not in str(key):
            continue
        name, _, operator = str(key).rpartition("__")
        field_spec = spec.by_name.get(name)
        if field_spec is None or not field_spec.filterable:
            continue
        raw = args.get(key)
        if _blank_argument(raw):
            continue
        predicate = build_predicate(field_spec, operator, raw)
        if predicate is not None:
            stmt = stmt.where(predicate)

    term = _as_text(args.get("q") or "").strip()
    if term:
        if len(term) > MAX_FILTER_CHARS:
            raise ValidationError(f"q must be at most {MAX_FILTER_CHARS} characters")
        searchable = spec.searchable
        if searchable:
            stmt = stmt.where(or_(*(f.expression.ilike(f"%{term}%") for f in searchable)))
    return stmt


def apply_sort(stmt: Select, page, spec: FieldSet, *, default: str) -> Select:
    """Order by the requested column, keeping NULLs out of the reader's way.

    Descending means "most interesting first", and a NULL is never the most
    interesting row — an undated record at the top of a newest-first list is
    exactly where nobody expects it.

    Multi-column sort (§3) rides in as `sort=a,b` / `order=asc,desc`; the extra
    keys are applied in order after the primary one.
    """
    fields = [f.strip() for f in str(page.sort or "").split(",") if f.strip()] or [default]
    orders = [o.strip() for o in str(page.order or "desc").split(",") if o.strip()]

    clauses = []
    for index, name in enumerate(fields):
        column = spec.sort_column(name, default)
        direction = orders[index] if index < len(orders) else orders[-1] if orders else "desc"
        clauses.append(
            column.desc().nullslast() if direction == "desc" else column.asc().nullsfirst()
        )

    # A total order, always. Two rows sharing an `updated_at` have no defined
    # position relative to each other, and PostgreSQL is free to return them in
    # a different order for each query — so page 2 of an OFFSET scan can repeat
    # a row from page 1 and never show another one at all. A seeded dataset,
    # where thousands of rows are written in one transaction, hits this
    # immediately; production hits it eventually and blames the reader.
    identity = spec.by_name.get("id")
    if identity is not None and "id" not in fields:
        clauses.append(identity.column.asc())
    return stmt.order_by(*clauses)


def count_of(session, stmt: Select) -> int:
    """Total matching rows, without the LIMIT/OFFSET of the page itself.

    The limit is *stripped* rather than assumed absent. Every caller today
    counts before paging, so the promise held by convention — and a promise
    held by convention is one the next caller breaks, in the quietest way
    available: a footer reading "1–25 of 25" for a filtered set of four
    thousand.
    """
    return session.scalar(
        select(func.count()).select_from(stmt.limit(None).offset(None).subquery())
    ) or 0


def facets_for(session, stmt: Select, spec: FieldSet, *, limit: int = 50) -> dict[str, list[dict]]:
    """Distinct values and counts for each faceted column, under the *other*
    filters currently applied.

    Computed from the filtered statement so the menu shows what is reachable
    from where the user already is, rather than every value in the table. The
    statement is reused rather than rebuilt, which is what keeps facet counts
    honest: they can never disagree with the rows below them.
    """
    out: dict[str, list[dict]] = {}
    for field_spec in spec.facets:
        column = field_spec.column
        counted = (
            stmt.with_only_columns(column, func.count(), maintain_column_froms=True)
            .group_by(column)
            .order_by(func.count().desc())
            .limit(limit)
        )
        out[field_spec.name] = [
            {"value": str(value), "count": count}
            for value, count in session.execute(counted).all()
            if value is not None
        ]
    return out
