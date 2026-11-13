"""Composing a document automatically from a report's question."""

from __future__ import annotations

from typing import Any

from src.core import audit
from src.models.personal import ReportDocument
from src.services.analytics import analysis
from src.services.analytics.report_documents.serializers import (
    _copy_name,
    _period_label,
    _serialize,
    _slug,
    _state,
)
from src.services.analytics.report_documents.validation import _blocks
from src.services.analytics.report_documents.vocabulary import (
    DEFAULT_PAGE,
    KIND,
    MANAGE_PERMISSION,
)
from src.services.records import explorer


def compose(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """A whole document about a dataset, from what the dataset declares.

    The empty document is the honest starting point and it is still a blank
    page: somebody who wants "the monthly orders report" has to choose eight
    blocks, name a grouping for each, and know which of them are worth having
    before they have seen one. That is a lot to ask of a first use.

    So this composes the report a person would have written: a summary, the
    dataset's own headline numbers, a chart per grouping it declares worth
    grouping by, and the newest rows. **Nothing here is invented.** Every part
    comes from the same declarations the explorer and the analysis catalogue
    publish — `Insight`s for the numbers, `dimensions` for the charts,
    `default_columns` for the table — so a dataset that gains a field gains a
    section, and one that declares nothing produces a document that says so
    rather than a page of empty frames.

    It is a *starting point*, not an answer: the blocks are ordinary blocks and
    every one of them can be edited or removed. A generator whose output could
    not be changed would be a template with extra steps.
    """
    principal.require(MANAGE_PERMISSION)
    entity = str((payload or {}).get("entity") or "").strip()
    resource = explorer.resource_for(entity, principal=principal)
    period = str((payload or {}).get("period") or "last_30_days")

    catalogue = analysis.catalogue(principal=principal)
    dataset = next(
        (item for item in catalogue["datasets"] if item["key"] == entity), None
    )
    dimensions = (dataset or {}).get("dimensions") or []
    date_field = (dataset or {}).get("default_date") or ""

    blocks: list[dict[str, Any]] = []

    def add(block: dict[str, Any]) -> None:
        block["id"] = f"b{len(blocks) + 1}"
        blocks.append(block)

    add({"kind": "HEADING", "text": "Summary", "level": 2})
    add({
        "kind": "TEXT",
        # Written as a prompt rather than as filler: a paragraph of generated
        # prose about data nobody has looked at is the kind of thing that gets
        # sent to a board unedited.
        "text": (
            f"{resource.label} over the last thirty days. "
            "Replace this paragraph with what the numbers below actually mean — "
            "the figures are computed when the file is written, the reading of "
            "them is yours."
        ),
    })
    add({"kind": "METRICS", "entity": entity, "caption": "Where it stands", "filters": {}})

    # Over time, when the dataset declares a date worth counting by. A report
    # without a trend line is a snapshot, and most of what anybody wants from
    # one of these is the direction.
    if date_field:
        add({"kind": "HEADING", "text": "Over time", "level": 2})
        add({
            "kind": "CHART",
            "entity": entity,
            "dimension": date_field,
            "granularity": "month",
            "aggregation": "count",
            "chart": "area",
            "period": period,
            "show": "chart",
            "caption": f"{resource.label} by month",
            "filters": {},
        })

    # One chart per declared grouping, to a limit: three sections is a report
    # somebody reads and nine is one they skim.
    for dimension in dimensions[:3]:
        add({"kind": "HEADING", "text": f"By {dimension['label'].lower()}", "level": 2})
        add({
            "kind": "CHART",
            "entity": entity,
            "dimension": dimension["name"],
            "aggregation": "count",
            # A bar for a handful of categories, a treemap when there are many:
            # twenty bars is a picture nobody reads the labels of.
            "chart": "bar" if len(dimension.get("choices") or []) <= 8 else "treemap",
            "period": period,
            "show": "chart",
            "caption": f"By {dimension['label'].lower()}",
            "filters": {},
        })

    add({"kind": "PAGE_BREAK"})
    add({"kind": "HEADING", "text": "The records themselves", "level": 2})
    add({
        "kind": "TABLE",
        "entity": entity,
        "columns": list(resource.default_columns[:5]),
        "sort": resource.default_sort,
        "order": "desc",
        "limit": 25,
        "caption": f"The twenty-five most recent {resource.label.lower()}",
        "filters": {},
    })

    values = {
        "name": _copy_name(session, f"{resource.label} report", principal),
        "description": f"Composed from what the {resource.label.lower()} dataset declares.",
        "scope": "PRIVATE",
        "page": {**DEFAULT_PAGE, "subtitle": _period_label(period)},
        "blocks": _blocks(blocks, principal=principal),
    }

    row = ReportDocument(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        slug=_slug(values["name"]),
        **values,
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"composed a report about {resource.label}", activity=False,
    )
    return _serialize(session, row, principal)
