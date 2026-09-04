"""One question asked of every dataset at once (§32).

Data Explorer answers "which tasks match this?"; global search answers "where
does this appear at all?" — the question somebody has when they know a
reference number and not which screen it belongs to.

Two decisions shape the implementation.

**It reuses the explorer's resource declarations.** The datasets, their
searchable fields and the permission each needs are declared once in
`services/explorer.py`; global search adds no second list to keep in step, and
a resource the caller may not read is not searched rather than searched and
filtered afterwards.

**Ranking happens in SQL, and is explainable.** Results from six tables have to
be ordered against each other, so each row is scored by *how* it matched — an
exact value beats a prefix, which beats an occurrence in the middle of a
sentence — and by which field matched, since a reference is a stronger signal
than a description. The score is returned with each hit so the interface can
say why something is at the top, and a test can assert the order rather than
observe it.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import Select, String, case, cast, func, literal, or_, select

from src.core.errors import ValidationError
from src.core.query import MAX_FILTER_CHARS
from src.services.explorer import Resource, resources

#: Below this, a term matches so much that the ranking is noise.
MIN_TERM = 2
#: Per dataset. The reader is looking for one record, not reading a report.
DEFAULT_PER_RESOURCE = 5
MAX_PER_RESOURCE = 25

#: How well the value matched, highest first. Ordering these by strength rather
#: than by field means "TSK-00042" outranks a task whose description mentions it.
EXACT, PREFIX, CONTAINS = 100, 60, 30

#: Fields earlier in a resource's declaration are the ones it leads with — a
#: reference or a name — so a match there is worth more than one further down.
FIELD_WEIGHT_STEP = 4


def _score(spec, term: str, position: int):
    """A CASE expression scoring one field's match, computed by PostgreSQL."""
    column = func.lower(func.coalesce(spec.expression, ""))
    needle = term.lower()
    weight = max(0, 12 - position * FIELD_WEIGHT_STEP)
    return case(
        (column == needle, EXACT + weight),
        (column.like(f"{needle}%"), PREFIX + weight),
        (column.like(f"%{needle}%"), CONTAINS + weight),
        else_=0,
    )


def _statement(resource: Resource, term: str) -> Select:
    """Rows of one resource that match, with their score and why they matched."""
    searchable = resource.fields.searchable
    scores = [_score(spec, term, index) for index, spec in enumerate(searchable)]
    # `greatest` and not a sum: a row matching three fields weakly is not a
    # better answer than one matching its reference exactly.
    relevance = func.greatest(*scores) if len(scores) > 1 else scores[0]

    # Which field earned that score, and what it holds. Without this a result
    # can be top of the list for a reason the reader cannot see — the match is
    # in a description that is not one of the two columns shown.
    matched_field = case(
        *((score == relevance, literal(spec.name)) for score, spec in zip(scores, searchable)),
        else_=literal(""),
    )
    matched_value = case(
        *(
            (score == relevance, func.coalesce(cast(spec.expression, String), ""))
            for score, spec in zip(scores, searchable)
        ),
        else_=literal(""),
    )

    label = resource.fields.by_name[resource.default_columns[0]]
    summary = resource.fields.by_name.get(
        resource.default_columns[1] if len(resource.default_columns) > 1 else label.name
    )

    statement = select(
        resource.model.id.label("id"),
        func.coalesce(label.expression, "").label("label"),
        func.coalesce(summary.expression, "").label("summary"),
        relevance.label("score"),
        matched_field.label("matched_field"),
        matched_value.label("matched_value"),
        literal(resource.key).label("resource_type"),
    ).where(or_(*(spec.expression.ilike(f"%{term}%") for spec in searchable)))

    deleted = getattr(resource.model, "deleted_at", None)
    if deleted is not None:
        statement = statement.where(deleted.is_(None))
    return statement.order_by(relevance.desc(), label.expression.asc())


def search(session, args, *, principal) -> dict[str, Any]:
    """Search every dataset the caller may read, grouped and ranked."""
    term = str(args.get("q") or "").strip()
    if len(term) > MAX_FILTER_CHARS:
        raise ValidationError(f"q must be at most {MAX_FILTER_CHARS} characters")

    per_resource = _per_resource(args)
    if len(term) < MIN_TERM:
        # Not an error: an empty box is the normal state of a search page, and
        # "type at least two characters" is guidance, not a failure.
        return {"query": term, "total": 0, "groups": [], "truncated": False}

    groups: list[dict[str, Any]] = []
    total = 0
    truncated = False

    for resource in resources().values():
        if not principal.can(resource.permission) or not resource.fields.searchable:
            continue
        statement = _statement(resource, term)
        rows = session.execute(statement.limit(per_resource + 1)).all()
        if not rows:
            continue
        more = len(rows) > per_resource
        truncated = truncated or more
        hits = rows[:per_resource]
        total += len(hits)
        groups.append({
            "resource_type": resource.key,
            "label": resource.label,
            "description": resource.description,
            "has_more": more,
            "items": [
                {
                    "id": str(row.id),
                    "label": str(row.label),
                    "summary": str(row.summary),
                    "score": int(row.score or 0),
                    "matched_field": row.matched_field or "",
                    "matched_label": _field_label(resource, row.matched_field),
                    "snippet": _snippet(str(row.matched_value or ""), term),
                    "resource_type": resource.key,
                }
                for row in hits
            ],
        })

    # Strongest group first: the reader's answer is usually in one dataset, and
    # scanning six headings to find it defeats the point of ranking at all.
    groups.sort(key=lambda group: group["items"][0]["score"], reverse=True)
    return {"query": term, "total": total, "groups": groups, "truncated": truncated}


def _field_label(resource: Resource, name: str | None) -> str:
    spec = resource.fields.by_name.get(str(name or ""))
    return spec.title if spec else ""


#: Enough context around a hit to recognise it, short enough for one line.
SNIPPET_WIDTH = 140


def _snippet(value: str, term: str) -> str:
    """The matched text, cut around the term rather than from the start.

    A description truncated at 140 characters usually stops before the word
    somebody searched for, which is the one word the snippet exists to show.
    """
    if len(value) <= SNIPPET_WIDTH:
        return value
    at = value.lower().find(term.lower())
    if at < 0:
        return value[:SNIPPET_WIDTH].rstrip() + "…"
    start = max(0, at - SNIPPET_WIDTH // 3)
    end = min(len(value), start + SNIPPET_WIDTH)
    return ("…" if start else "") + value[start:end].strip() + ("…" if end < len(value) else "")


def _per_resource(args) -> int:
    raw = args.get("per_resource", DEFAULT_PER_RESOURCE)
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValidationError("per_resource must be an integer") from exc
    if value < 1 or value > MAX_PER_RESOURCE:
        raise ValidationError(f"per_resource must be between 1 and {MAX_PER_RESOURCE}")
    return value
