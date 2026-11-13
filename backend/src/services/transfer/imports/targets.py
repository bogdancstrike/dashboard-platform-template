"""What can be imported, and the fields each target accepts."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, select

from src.core import importer, vocabulary
from src.core.errors import ValidationError
from src.models.platform import ImportRun
from src.services.records import explorer

#: Writing records from a file is its own privilege, and a narrow one:
#: ADMINISTRATOR and MANAGER hold it. It is also what `/import` declares in the
#: navigation, and the route guard reads the navigation entry — so the two must
#: agree or the page is reachable by roles that cannot use it.
PERMISSION = "records.import"


#: The prefix an import's human identifier carries — `IMP-000123`.
REFERENCE_PREFIX = "IMP"


#: How many imports one person may have open at once.
#:
#: A draft holds its whole file in JSONB, so this is a bound on rows as much as
#: on rows-of-the-table. Generous enough that nobody meets it by accident.
MAX_OPEN_PER_PERSON = 5


def _targets(principal) -> dict[str, Any]:
    """The datasets this person may import into.

    A dataset appears only if it declares an `identity` — how a created record
    is named — because that is exactly the declaration that says the API can
    create one. A picker offering a dataset whose create 400s would be a picker
    wasting somebody's time (§76).
    """
    return {
        key: resource
        for key, resource in explorer.resources().items()
        if resource.identity is not None and principal.can(resource.permission)
    }


def _field_catalogue(resource) -> list[dict[str, Any]]:
    """Which fields a file may be mapped onto, and what each accepts.

    Read from the same `Writable` declarations the edit form is rendered from,
    so a field that becomes writable becomes importable the same day — and one
    that does not is not offered.
    """
    out = []
    for name, spec in sorted(resource.writable.items()):
        field = resource.fields.by_name[name]
        out.append(
            {
                "name": name,
                "label": field.title,
                "kind": field.kind,
                "required": spec.required,
                "choices": list(field.choices),
                "minimum": spec.minimum,
                "maximum": spec.maximum,
                # What a foreign key points at, so the wizard can say "this
                # column must hold a customer's id or reference".
                "references": explorer.references_of(field),
            }
        )
    return out


def catalogue(session, *, principal) -> dict[str, Any]:
    """What can be imported, the limits that apply, and where mine stand."""
    principal.require(PERMISSION)
    targets = _targets(principal)

    tallied = session.execute(
        select(ImportRun.status, func.count(ImportRun.id))
        .where(ImportRun.created_by_id == principal.user_id)
        .group_by(ImportRun.status)
    ).all()
    statuses = {status: int(count) for status, count in tallied}

    return {
        "targets": [
            {
                "key": resource.key,
                "label": resource.label,
                "description": resource.description,
                "fields": _field_catalogue(resource),
                "required": sorted(
                    name for name, spec in resource.writable.items() if spec.required
                ),
            }
            for resource in sorted(targets.values(), key=lambda item: item.label)
        ],
        "delimiters": [
            {"key": delimiter, "label": importer.name_of(delimiter)}
            for delimiter in importer.DELIMITERS
        ],
        "max_rows": importer.MAX_ROWS,
        "max_bytes": importer.MAX_BYTES,
        "preview_rows": importer.PREVIEW_ROWS,
        "open_limit": MAX_OPEN_PER_PERSON,
        "open": sum(statuses.get(status, 0) for status in vocabulary.IMPORT_OPEN),
        "statuses": [{"key": status, "count": statuses[status]} for status in sorted(statuses)],
        "steps": list(vocabulary.IMPORT_STEP),
        "total": sum(statuses.values()),
    }


def _resource_for(key: Any, *, principal):
    """The target dataset, or a refusal naming what may be imported into."""
    targets = _targets(principal)
    resource = targets.get(str(key or ""))
    if resource is None:
        raise ValidationError(
            "That dataset cannot be imported into.",
            details={"target_entity": str(key or ""), "available": sorted(targets)},
        )
    return resource
