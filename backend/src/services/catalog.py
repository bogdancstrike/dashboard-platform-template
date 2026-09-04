"""The data catalogue (§65, §71) — what the platform holds, and how good it is.

Every other screen asks a question *of* the data. This one describes the data
itself: which datasets exist, what each field is, which operators it accepts,
how many records carry a value for it, and how recently anything changed.

It is generated from the same `Resource` declarations the explorer, the query
builder and global search read, so a catalogue entry cannot describe a field
that does not exist or omit one that does. That is the property worth having:
a catalogue maintained by hand is a catalogue that is wrong within a month.

Completeness is measured, not asserted. `COUNT(column)` skips NULLs, so one
aggregate query per dataset — every column counted in a single pass — gives
the true fill rate of each field over every row, rather than over a sample.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import String, cast, func, select

from src.core import cache
from src.core.clock import iso
from src.core.errors import ValidationError
from src.services.explorer import Resource, resources

#: Profiling scans every row, so the answer is held briefly rather than
#: recomputed per keystroke. Short enough that a reseed shows up quickly.
PROFILE_TTL = 300

#: Below this share of rows carrying a value, a field is worth remarking on.
SPARSE_BELOW = 0.5
#: A dataset nothing has touched in this long is worth remarking on too.
STALE_AFTER_DAYS = 90


def catalogue(session, *, principal, refresh: bool = False) -> dict[str, Any]:
    """Every dataset the caller may read, profiled."""
    visible = [item for item in resources().values() if principal.can(item.permission)]
    items = [
        cache.cached(
            "catalog",
            {"resource": resource.key},
            lambda resource=resource: _profile(session, resource),
            ttl=PROFILE_TTL,
        )
        if not refresh
        else _profile(session, resource)
        for resource in visible
    ]
    return {
        "items": items,
        "total": len(items),
        "field_count": sum(len(item["fields"]) for item in items),
        "record_count": sum(item["record_count"] for item in items),
    }


def dataset(session, key: Any, *, principal) -> dict[str, Any]:
    """One dataset's entry, for a deep link into the catalogue."""
    resource = resources().get(str(key or ""))
    if resource is None:
        raise ValidationError(
            "Unknown dataset.",
            details={"resource_type": str(key or ""), "available": sorted(resources())},
        )
    principal.require(resource.permission)
    return cache.cached(
        "catalog", {"resource": resource.key},
        lambda: _profile(session, resource), ttl=PROFILE_TTL,
    )


def _profile(session, resource: Resource) -> dict[str, Any]:
    """Count, fill rates and freshness for one dataset, in two queries."""
    model = resource.model
    deleted = getattr(model, "deleted_at", None)
    live = [] if deleted is None else [deleted.is_(None)]

    # Every column's non-NULL count in one pass. A query per field would be
    # forty round trips to say the same thing.
    aggregates = [func.count().label("rows")]
    for spec in resource.fields.fields:
        aggregates.append(func.count(spec.column).label(f"n_{spec.name}"))
    if hasattr(model, "updated_at"):
        aggregates.append(func.max(model.updated_at).label("newest"))
        aggregates.append(func.min(model.updated_at).label("oldest"))

    row = session.execute(select(*aggregates).where(*live)).one()
    total = int(row.rows or 0)

    fields = [
        _field_entry(spec, getattr(row, f"n_{spec.name}", 0), total)
        for spec in resource.fields.fields
    ]

    return {
        "key": resource.key,
        "label": resource.label,
        "description": resource.description,
        "permission": resource.permission,
        "record_count": total,
        "default_sort": resource.default_sort,
        "default_columns": list(resource.default_columns),
        "updated_at": iso(getattr(row, "newest", None)),
        "created_at": iso(getattr(row, "oldest", None)),
        "searchable_fields": [spec.name for spec in resource.fields.searchable],
        "facet_fields": [spec.name for spec in resource.fields.facets],
        "fields": fields,
        "notes": _notes(resource, fields, total, getattr(row, "newest", None)),
    }


def _field_entry(spec, present: Any, total: int) -> dict[str, Any]:
    filled = int(present or 0)
    return {
        "name": spec.name,
        "label": spec.title,
        "kind": spec.kind,
        "filterable": spec.filterable,
        "sortable": spec.sortable,
        "searchable": spec.searchable,
        "facet": spec.facet,
        "choices": list(spec.choices),
        "operators": sorted(_operators(spec)),
        "filled": filled,
        # Rounded to a tenth: "97.3% complete" is actionable, "97.2841%" is noise.
        "completeness": round(filled / total * 100, 1) if total else 0.0,
    }


def _operators(spec) -> frozenset[str]:
    from src.core.query import OPERATORS, OPERATORS_BY_KIND

    return OPERATORS_BY_KIND.get(spec.kind, OPERATORS) if spec.filterable else frozenset()


def _notes(resource: Resource, fields: list[dict[str, Any]], total: int, newest) -> list[dict[str, str]]:
    """What a reader should know before trusting this dataset.

    Observations, not judgements: a mostly-empty optional field is normal, and
    saying so beside the number is what stops somebody reading 12% as a defect.
    """
    notes: list[dict[str, str]] = []
    if total == 0:
        notes.append({
            "level": "warning",
            "message": "This dataset is empty, so filters on it return nothing.",
        })
        return notes

    sparse = [field for field in fields if field["completeness"] < SPARSE_BELOW * 100]
    if sparse:
        names = ", ".join(field["label"] for field in sparse[:5])
        notes.append({
            "level": "info",
            "message": (
                f"Fewer than half the records carry a value for {names}"
                f"{' and others' if len(sparse) > 5 else ''}. "
                "Filtering on one of those narrows the results twice: by the "
                "condition, and by which records were filled in at all."
            ),
        })

    if newest is not None:
        from src.core.clock import now

        age = (now() - newest).days
        if age > STALE_AFTER_DAYS:
            notes.append({
                "level": "warning",
                "message": f"Nothing in this dataset has changed for {age} days.",
            })

    if not resource.fields.searchable:
        notes.append({
            "level": "info",
            "message": "No field here is free-text searchable, so a plain term will not match it.",
        })
    return notes


def sample(session, key: Any, *, principal, field: str) -> dict[str, Any]:
    """The values a field actually holds, most common first.

    The catalogue's honest answer to "what can I put in this filter?" — the
    declared choices are what the code allows, and this is what the data has.
    """
    resource = resources().get(str(key or ""))
    if resource is None:
        raise ValidationError("Unknown dataset.", details={"resource_type": str(key or "")})
    principal.require(resource.permission)

    spec = resource.fields.by_name.get(str(field or ""))
    if spec is None:
        raise ValidationError(
            "Unknown field.",
            details={"field": str(field or ""), "available": sorted(resource.fields.by_name)},
        )

    deleted = getattr(resource.model, "deleted_at", None)
    column = cast(spec.column, String)
    statement = (
        select(column.label("value"), func.count().label("count"))
        .where(spec.column.is_not(None))
        .group_by(column)
        .order_by(func.count().desc())
        .limit(20)
    )
    if deleted is not None:
        statement = statement.where(deleted.is_(None))

    return {
        "resource_type": resource.key,
        "field": spec.name,
        "label": spec.title,
        "values": [
            {"value": row.value, "count": int(row.count)}
            for row in session.execute(statement).all()
        ],
    }
