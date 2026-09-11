"""Report documents: a page somebody composed, exported as PDF or DOCX (§28).

**This is the thing `/reports/builder` was missing, and the reason it and the
chart builder used to be the same screen wearing two names.** A *report* is a
saved question — a dataset, a grouping, a measure and a picture — and running
one answers it. A *document* is a page: a cover, headings, paragraphs somebody
wrote, and the answers to several questions arranged between them, on paper of
a stated size with a running header and a page number. Nothing in the analysis
stack had anywhere to put a footer, which is why "customise a report" had no
home until this existed.

Four rules hold, and each is the same rule a dashboard widget follows.

**A block that shows data names a question; it does not restate one.** A
`REPORT` block carries a report id and runs the stored definition through the
same compiler the chart builder previews with. Copying the definition into the
document would be a second copy that drifts the first time either is edited.

**The document stores no answers.** Rendering runs the questions again, so a
document exported in March and again in June is the same layout over June's
data — which is what "a monthly report" means. A document that cached its
numbers would be a screenshot with a file extension.

**Every block is resolved under the reader's own permissions.** A document
shared with somebody who may not read the dataset behind block four renders
with a line saying so rather than with the rows: sharing a layout has never
been sharing data, and it is not here either.

**A block that cannot be resolved renders as a note, not as an exception.** A
report that was deleted, a dataset a role cannot read, a table with no rows —
each is a sentence in the document. The person exporting is usually about to
send the file to somebody, and one honest gap beats a 500.

Sharing is `core/sharing`, the same mechanism saved searches, reports and
dashboards use.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.core import audit, documents, sharing
from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.pagination import parse_uuid
from src.models.personal import ReportDocument
from src.services import analysis, explorer, reports

#: The polymorphic key `resource_shares` files a document's audience under.
KIND = "report_document"

MANAGE_PERMISSION = "reports.manage"
VIEW_PERMISSION = "reports.view"
SHARE_PERMISSION = "searches.share"

#: What a document may be made of. Each has a renderer in `core/documents` and
#: a resolver below; a kind with neither would be a block that silently
#: vanishes from the export.
BLOCK_KINDS = frozenset({
    "HEADING",
    "TEXT",
    "REPORT",
    # A chart that composes its *own* question, the way a `TABLE` block does.
    #
    # `REPORT` draws something already saved, which is right when the question
    # exists — and useless when it does not, because it made "put a chart in
    # this report" begin with "go and build a report". A table block was always
    # allowed to name a dataset and a sort; there is no reason a chart may not
    # name a dataset and a grouping, and one compiler answers both.
    "CHART",
    "TABLE",
    "METRICS",
    "DIVIDER",
    "SPACER",
    "PAGE_BREAK",
})

#: Blocks that ask the platform a question, and so need permission checking.
DATA_KINDS = frozenset({"REPORT", "CHART", "TABLE", "METRICS"})

#: Every picture a `CHART` block may ask for — the chart builder's vocabulary,
#: because a block that could draw a shape the product cannot is a block that
#: renders an apology.
CHART_KINDS = frozenset({
    "bar", "hbar", "line", "area", "pie", "multi-line", "stacked-area",
    "stacked-bar", "stacked-hbar", "funnel", "treemap", "scatter", "radar",
    "heatmap",
})

#: A document longer than this is a book, and a JSON column is the wrong home.
MAX_BLOCKS = 80

#: Rows one table block may draw. Past this a document stops being a report and
#: becomes an export — which the platform already does properly (§30).
MAX_TABLE_ROWS = 200
DEFAULT_TABLE_ROWS = 20

PAGE_SIZES = frozenset({"A4", "LETTER"})
ORIENTATIONS = frozenset({"portrait", "landscape"})
SHOW_MODES = frozenset({"chart", "table", "both"})

FORMATS = frozenset({"pdf", "docx"})

#: The paper a document gets when nobody has said. A4 portrait with 20mm
#: margins is what most of the world prints on; the cover is on because a
#: report that arrives with a title page reads as deliberate.
DEFAULT_PAGE: dict[str, Any] = {
    "size": "A4",
    "orientation": "portrait",
    "margin_mm": 20,
    "header": "",
    "footer": "",
    "subtitle": "",
    "page_numbers": True,
    "cover": True,
    "accent": "#5b5bd6",
}

#: What a new document starts as. Not empty: a builder that opens on nothing
#: makes somebody guess what a block even is, and the first two blocks of
#: every report ever written are a heading and a paragraph.
STARTER_BLOCKS: list[dict[str, Any]] = [
    {"id": "b1", "kind": "HEADING", "text": "Summary", "level": 2},
    {
        "id": "b2",
        "kind": "TEXT",
        "text": "What this report covers, and what somebody reading it should take from it.",
    },
]


def listing(session, *, principal) -> dict[str, Any]:
    """Every document this reader may open, their own first."""
    principal.require(VIEW_PERMISSION)
    rows = session.scalars(
        select(ReportDocument)
        .options(selectinload(ReportDocument.owner))
        .where(
            ReportDocument.deleted_at.is_(None),
            sharing.visibility(ReportDocument, KIND, principal),
        )
        .order_by(ReportDocument.updated_at.desc(), ReportDocument.name.asc())
    ).unique().all()

    return {
        "items": [_serialize(session, row, principal, blocks=False) for row in rows],
        "total": len(rows),
        "block_kinds": sorted(BLOCK_KINDS),
        "formats": sorted(FORMATS),
        "page_sizes": sorted(PAGE_SIZES),
        "defaults": dict(DEFAULT_PAGE),
        # Only the datasets this reader may read, so a table block cannot be
        # pointed at one that would render as a refusal.
        "datasets": [
            {"key": resource.key, "label": resource.label, "path": resource.path}
            for resource in explorer.resources().values()
            if principal.can(resource.permission)
        ],
        "can_create": principal.can(MANAGE_PERMISSION),
        "can_share": principal.can(SHARE_PERMISSION),
    }


def get(session, document_id: Any, *, principal) -> dict[str, Any]:
    return _serialize(session, _visible(session, document_id, principal), principal)


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    values = _validated(payload, principal=principal, partial=False)
    members = values.pop("member_ids")

    row = ReportDocument(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        slug=_slug(values["name"]),
        **values,
    )
    # Only when the caller said nothing at all: a create that carried blocks
    # means somebody already composed something, and overwriting it with a
    # starter would be the builder deciding it knew better.
    if row.blocks is None:
        row.blocks = [dict(block) for block in STARTER_BLOCKS]
    if row.page is None:
        row.page = dict(DEFAULT_PAGE)

    session.add(row)
    session.flush()
    sharing.replace_members(
        session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
    )
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"created report document {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def update(session, document_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, document_id, principal)
    values = _validated(payload, principal=principal, partial=True, existing=row)
    members = values.pop("member_ids", None)
    before = _state(row)

    for key, value in values.items():
        setattr(row, key, value)
    if members is not None:
        sharing.replace_members(
            session, KIND, row.id, members, principal=principal, owner_id=row.owner_id,
        )
    session.flush()
    audit.record(
        session,
        action="SHARE" if "scope" in values or members is not None else "UPDATE",
        resource_type=KIND, resource_id=row.id, resource_label=row.name,
        principal=principal, before=before, after=_state(row),
        message=f"updated report document {row.name}", activity=False,
    )
    return _serialize(session, row, principal)


def remove(session, document_id: Any, *, principal) -> dict[str, Any]:
    principal.require(MANAGE_PERMISSION)
    row = _owned(session, document_id, principal)
    before = _state(row)
    row.deleted_at = now()
    audit.record(
        session, action="DELETE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, before=before,
        message=f"deleted report document {row.name}", activity=False,
    )
    return {"id": str(row.id), "deleted": True, "name": row.name}


def duplicate(session, document_id: Any, *, principal) -> dict[str, Any]:
    """A private copy, owned by whoever asked — the template pattern.

    A document is the closest thing this platform has to a template: the
    quarterly review is the same six blocks with a different period every time.
    Copying is how that works, and the copy shares nothing, because inheriting
    the original's audience would publish an unfinished draft to its members.
    """
    principal.require(MANAGE_PERMISSION)
    source = _visible(session, document_id, principal)
    row = ReportDocument(
        owner_id=principal.user_id,
        organization_id=principal.organization_id,
        name=_copy_name(session, source.name, principal),
        slug=_slug(source.name),
        description=source.description,
        scope="PRIVATE",
        page=dict(source.page or DEFAULT_PAGE),
        blocks=[dict(block) for block in (source.blocks or [])],
    )
    session.add(row)
    session.flush()
    audit.record(
        session, action="CREATE", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal, after=_state(row),
        message=f"copied report document {source.name}", activity=False,
    )
    return _serialize(session, row, principal)


# ── rendering ────────────────────────────────────────────────────────────


def render(session, document_id: Any, payload: dict[str, Any], *, principal):
    """The document as a file the caller can save.

    `payload["images"]` maps a block id to a `data:image/png;base64,…` the
    *client* drew. There is no chart engine in this process, and adding one
    would be a second implementation of every picture the product draws —
    different fonts, different colours, a legend that disagrees with the
    screen. The browser has already drawn the chart; what lands in the file is
    what was on screen. A block whose image did not arrive falls back to its
    own numbers as a table, which is the honest degradation.
    """
    from flask import Response

    row = _visible(session, document_id, principal)
    fmt = str((payload or {}).get("format") or "pdf").strip().lower()
    if fmt not in FORMATS:
        raise ValidationError(
            "That is not a format this platform writes.",
            details={"format": fmt, "allowed": sorted(FORMATS)},
        )

    images = (payload or {}).get("images")
    if images is not None and not isinstance(images, dict):
        raise ValidationError("images must be an object keyed by block id.")

    page = {**DEFAULT_PAGE, **(row.page or {})}
    resolved = resolve(
        session, row, principal=principal, images=images or {}, orientation=page["orientation"],
    )

    body = (
        documents.render_pdf(title=row.name, page=page, blocks=resolved)
        if fmt == "pdf"
        else documents.render_docx(title=row.name, page=page, blocks=resolved)
    )

    row.render_count = int(row.render_count or 0) + 1
    row.last_rendered_at = now()
    session.flush()
    audit.record(
        session, action="EXPORT", resource_type=KIND, resource_id=row.id,
        resource_label=row.name, principal=principal,
        message=f"exported {row.name} as {fmt.upper()}", activity=False,
    )

    name = documents.filename(row.name, fmt)
    return Response(
        body,
        mimetype=documents.content_type(fmt),
        headers={
            "Content-Disposition": f'attachment; filename="{name}"',
            "Cache-Control": "no-store",
        },
    )


def resolve(
    session,
    row: ReportDocument,
    *,
    principal,
    images: dict[str, Any],
    orientation: str,
) -> list[dict[str, Any]]:
    """Every block, turned into content a renderer can lay out.

    Exported and separately testable, because this is where the interesting
    decisions are: which question each block asks, what happens when it cannot
    be asked, and how a table too wide for the page is narrowed.
    """
    out: list[dict[str, Any]] = []
    for block in row.blocks or []:
        kind = str(block.get("kind") or "")
        block_id = str(block.get("id") or "")

        if kind in {"HEADING", "TEXT"}:
            text = str(block.get("text") or "").strip()
            if text:
                out.append({"kind": kind, "text": text, "level": int(block.get("level") or 2)})
        elif kind in {"DIVIDER", "PAGE_BREAK"}:
            out.append({"kind": kind})
        elif kind == "SPACER":
            out.append({"kind": kind, "size": str(block.get("size") or "medium")})
        elif kind == "REPORT":
            out.extend(_resolve_report(session, block, principal=principal,
                                       image=images.get(block_id), orientation=orientation))
        elif kind == "CHART":
            out.extend(_resolve_chart(session, block, principal=principal,
                                      image=images.get(block_id), orientation=orientation))
        elif kind == "TABLE":
            out.append(_resolve_table(session, block, principal=principal,
                                      orientation=orientation))
        elif kind == "METRICS":
            out.append(_resolve_metrics(session, block, principal=principal))
    return out


def _resolve_report(
    session, block: dict[str, Any], *, principal, image: Any, orientation: str
) -> list[dict[str, Any]]:
    """A saved report, drawn as its own definition says and as it was previewed."""
    report_id = str(block.get("report_id") or "")
    caption = str(block.get("caption") or "")
    if not report_id:
        return [{"kind": "NOTE", "text": "A report block with no report chosen."}]

    try:
        answer = reports.run(session, report_id, {}, principal=principal)
    except Exception as error:  # noqa: BLE001 — every failure is one sentence
        return [{"kind": "NOTE", "text": _why("report", error)}]

    name = answer["report"]["name"]
    result = answer["result"]
    show = str(block.get("show") or "both")
    pieces: list[dict[str, Any]] = []

    png = documents.decode_png(image)
    if show in {"chart", "both"} and png:
        pieces.append({"kind": "IMAGE", "png": png, "caption": caption or name})
    if show in {"table", "both"} or (show == "chart" and not png):
        columns, rows = _tabulate(result)
        if rows:
            fitted, cut, dropped = documents.fit_columns(columns, rows, orientation)
            pieces.append({
                "kind": "TABLE",
                "caption": caption or name,
                "columns": fitted,
                "rows": cut,
                "note": f"{dropped} more columns are in the report itself." if dropped else "",
            })
        else:
            pieces.append({"kind": "NOTE", "text": f"{name} matched nothing."})

    if show == "chart" and not png and pieces:
        pieces.insert(0, {
            "kind": "NOTE",
            "text": "The chart could not be captured, so its numbers are below.",
        })
    return pieces or [{"kind": "NOTE", "text": f"{name} produced nothing to show."}]


def _resolve_chart(
    session, block: dict[str, Any], *, principal, image: Any, orientation: str
) -> list[dict[str, Any]]:
    """A chart the block composed itself, through the one analysis compiler.

    Identical in shape to `_resolve_report` and deliberately so: the only
    difference between the two is where the question came from. A saved report
    is a question somebody kept; this is one they asked here — and both are
    answered by `analysis.run`, so a document cannot disagree with the chart
    builder about what the same grouping means.
    """
    entity = str(block.get("entity") or "")
    caption = str(block.get("caption") or "")
    if not entity:
        return [{"kind": "NOTE", "text": "A chart block with no dataset chosen."}]

    request = {
        "resource_type": entity,
        "dimensions": [
            {
                "field": str(block.get("dimension") or ""),
                "granularity": str(block.get("granularity") or ""),
            }
        ],
        "measures": [_measure_of(block)],
        "filters": block.get("filters") or {},
        "period": block.get("period") or "",
    }
    if block.get("stack"):
        request["dimensions"].append({"field": str(block["stack"]), "granularity": ""})

    try:
        result = analysis.run(session, request, principal=principal)
    except Exception as error:  # noqa: BLE001 — every failure is one sentence
        return [{"kind": "NOTE", "text": _why("chart", error)}]

    show = str(block.get("show") or "chart")
    pieces: list[dict[str, Any]] = []
    # A block asking for the numbers alone does not get a picture even when the
    # browser captured one — otherwise the file disagrees with the preview.
    png = documents.decode_png(image) if show != "table" else None
    if png:
        pieces.append({"kind": "IMAGE", "png": png, "caption": caption})

    # The numbers, when the picture could not be captured — and when the block
    # asked for both. The same honest degradation a report block makes: the
    # numbers are the point and the picture was the presentation of them.
    if show in ("both", "table") or not png:
        columns, rows = _tabulate(result)
        if rows:
            fitted, cut, dropped = documents.fit_columns(columns, rows, orientation)
            pieces.append({
                "kind": "TABLE",
                "caption": caption,
                "columns": fitted,
                "rows": cut,
                "note": f"{dropped} more columns in the full result." if dropped else "",
            })

    if not pieces:
        return [{"kind": "NOTE", "text": "This chart matched nothing."}]
    if not png and show == "chart":
        pieces.insert(0, {
            "kind": "NOTE",
            "text": "The chart could not be captured, so its numbers are below.",
        })
    return pieces


def _measure_of(block: dict[str, Any]) -> dict[str, Any]:
    """What a chart block counts, or sums, or averages.

    Counting rows is the default because it is the only measure every dataset
    can answer — a block that defaulted to summing would need a numeric column
    chosen before it could draw anything at all.
    """
    aggregation = str(block.get("aggregation") or "count")
    field = str(block.get("measure") or "")
    if aggregation == "count" or not field:
        return {"aggregation": "count"}
    return {"aggregation": aggregation, "field": field}


def _tabulate(result: dict[str, Any]) -> tuple[list[str], list[list[str]]]:
    """An analysis result as a table — the grouping, then each measure."""
    dimensions = result.get("dimensions") or []
    measures = result.get("measures") or []
    columns = [str(item.get("label") or item.get("key") or "Group") for item in dimensions]
    columns += [str(item.get("label") or item.get("key") or "Value") for item in measures]

    rows: list[list[str]] = []
    for entry in result.get("rows") or []:
        keys = [str(value) for value in (entry.get("keys") or [])]
        values = [_number(entry.get("values", {}).get(item.get("key"))) for item in measures]
        rows.append(keys + values)
    return columns, rows


def _resolve_table(session, block: dict[str, Any], *, principal, orientation: str) -> dict[str, Any]:
    """Rows of a dataset, through the query every list in the product uses."""
    entity = str(block.get("entity") or "")
    if not entity:
        return {"kind": "NOTE", "text": "A table block with no dataset chosen."}

    limit = min(MAX_TABLE_ROWS, max(1, int(block.get("limit") or DEFAULT_TABLE_ROWS)))
    request = {
        "resource_type": entity,
        "filters": block.get("filters") or {},
        "columns": block.get("columns") or None,
        "sort": block.get("sort") or "",
        "order": block.get("order") or "desc",
        "page": 1,
        "page_size": limit,
    }
    try:
        answer = explorer.run(session, request, principal=principal)
    except Exception as error:  # noqa: BLE001
        return {"kind": "NOTE", "text": _why("dataset", error)}

    fields = {field["name"]: field["label"] for field in answer.get("fields", [])}
    columns = list(answer.get("columns") or [])
    rows = [[_cell(item.get(column)) for column in columns] for item in answer.get("items", [])]
    if not rows:
        return {"kind": "NOTE", "text": f"Nothing in {entity} matched this block."}

    labels = [fields.get(column, column) for column in columns]
    fitted, cut, dropped = documents.fit_columns(labels, rows, orientation)
    total = int(answer.get("total") or 0)
    notes = []
    if dropped:
        notes.append(f"{dropped} more columns")
    if total > len(rows):
        notes.append(f"{len(rows)} of {total:,} rows")
    return {
        "kind": "TABLE",
        "caption": str(block.get("caption") or ""),
        "columns": fitted,
        "rows": cut,
        "note": " · ".join(notes),
    }


def _resolve_metrics(session, block: dict[str, Any], *, principal) -> dict[str, Any]:
    """A dataset's declared headline numbers, as a strip."""
    entity = str(block.get("entity") or "")
    if not entity:
        return {"kind": "NOTE", "text": "A metrics block with no dataset chosen."}
    try:
        answer = explorer.insights(
            session,
            {"resource_type": entity, "filters": block.get("filters") or {}},
            principal=principal,
        )
    except Exception as error:  # noqa: BLE001
        return {"kind": "NOTE", "text": _why("dataset", error)}

    wanted = [str(key) for key in (block.get("metrics") or [])]
    metrics = answer.get("metrics") or []
    if wanted:
        metrics = [metric for metric in metrics if metric.get("key") in wanted]
    # Four across a portrait page; more and each tile is a column of digits.
    metrics = metrics[:4]
    if not metrics:
        return {"kind": "NOTE", "text": f"{entity} declares no headline numbers."}
    return {
        "kind": "METRICS",
        "caption": str(block.get("caption") or ""),
        "items": [
            {"label": str(metric.get("label") or ""), "value": _metric(metric)}
            for metric in metrics
        ],
    }


def _metric(metric: dict[str, Any]) -> str:
    """A declared metric, written the way its own format says."""
    value = metric.get("value")
    fmt = str(metric.get("format") or "number")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if fmt == "percent":
        return f"{number:,.1f}%"
    if fmt == "currency":
        return f"{number:,.0f}"
    if fmt in {"hours", "minutes"}:
        return f"{number:,.1f}"
    return f"{number:,.0f}" if number == int(number) else f"{number:,.2f}"


def _number(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "" if value is None else str(value)
    return f"{number:,.0f}" if number == int(number) else f"{number:,.2f}"


def _cell(value: Any) -> str:
    """One cell, as text. A JSON column is a shape, not a sentence."""
    if value is None:
        return ""
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, (list, dict)):
        return ", ".join(str(item) for item in value) if isinstance(value, list) else "…"
    return str(value)


def _why(what: str, error: Exception) -> str:
    """Why one block is a sentence instead of a table.

    Named rather than generic: a document with "could not be rendered" in it
    sends somebody to a developer, and "your role does not include orders" is
    something they can act on themselves (§34, §76).
    """
    message = str(getattr(error, "message", "") or error) or f"this {what} could not be read"
    return f"[{message}]"


# ── validation ───────────────────────────────────────────────────────────


def _validated(
    payload: dict[str, Any], *, principal, partial: bool, existing: ReportDocument | None = None
) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The document must be a JSON object.")

    out: dict[str, Any] = {}

    if not partial or "name" in payload:
        name = str(payload.get("name") or "").strip()
        if not name:
            raise ValidationError("A document needs a name people will recognise.")
        out["name"] = name[:200]

    if "description" in payload:
        description = payload.get("description")
        out["description"] = str(description).strip()[:2000] if description else None

    if not partial or "scope" in payload:
        out["scope"] = sharing.scope_of(
            payload.get("scope"),
            current=existing.scope if existing else "PRIVATE",
            principal=principal,
            share_permission=SHARE_PERMISSION,
        )

    if "page" in payload:
        out["page"] = _page(payload.get("page"))

    if "blocks" in payload:
        out["blocks"] = _blocks(payload.get("blocks"), principal=principal)

    if not partial or "member_ids" in payload:
        out["member_ids"] = sharing.requested_members(payload)

    return out


def _page(raw: Any) -> dict[str, Any]:
    """The paper, checked so a renderer never has to guess.

    Clamped rather than refused, because every value here has a sane
    neighbour: a 400mm margin on an A4 page is not a decision worth a round
    trip, it is a slider somebody dragged too far.
    """
    if raw is not None and not isinstance(raw, dict):
        raise ValidationError("page must be an object.")
    given = dict(raw or {})
    page = dict(DEFAULT_PAGE)

    size = str(given.get("size") or page["size"]).upper()
    page["size"] = size if size in PAGE_SIZES else "A4"

    orientation = str(given.get("orientation") or page["orientation"]).lower()
    page["orientation"] = orientation if orientation in ORIENTATIONS else "portrait"

    try:
        margin = float(given.get("margin_mm", page["margin_mm"]))
    except (TypeError, ValueError):
        margin = float(page["margin_mm"])
    page["margin_mm"] = max(5.0, min(50.0, margin))

    for key in ("header", "footer", "subtitle"):
        page[key] = str(given.get(key) or "")[:160]

    page["page_numbers"] = bool(given.get("page_numbers", True))
    page["cover"] = bool(given.get("cover", True))

    accent = str(given.get("accent") or page["accent"]).strip()
    # A colour the renderer can actually parse. Anything else takes the
    # platform's own accent rather than failing a save somebody made by typing.
    page["accent"] = accent if _is_hex(accent) else DEFAULT_PAGE["accent"]
    return page


def _is_hex(value: str) -> bool:
    return (
        len(value) == 7
        and value.startswith("#")
        and all(character in "0123456789abcdefABCDEF" for character in value[1:])
    )


def _blocks(raw: Any, *, principal) -> list[dict[str, Any]]:
    """The body, checked block by block.

    Shallow beyond the kind and the references, deliberately: a `TABLE` block's
    filters are executed by the explorer, which validates them properly, and
    re-deriving what a dataset may be filtered by here would be a second copy
    of the field catalogue.
    """
    if not isinstance(raw, list):
        raise ValidationError("blocks must be a list.")
    if len(raw) > MAX_BLOCKS:
        raise ValidationError(
            f"A document holds at most {MAX_BLOCKS} blocks.",
            details={"asked_for": len(raw)},
        )

    out: list[dict[str, Any]] = []
    for index, entry in enumerate(raw):
        if not isinstance(entry, dict):
            raise ValidationError("Each block must be an object.")
        kind = str(entry.get("kind") or "").strip().upper()
        if kind not in BLOCK_KINDS:
            raise ValidationError(
                "That is not a block this platform can render.",
                details={"kind": kind, "allowed": sorted(BLOCK_KINDS)},
            )

        block: dict[str, Any] = {"id": str(entry.get("id") or f"b{index + 1}")[:48], "kind": kind}

        if kind == "HEADING":
            block["text"] = str(entry.get("text") or "")[:200]
            level = int(entry.get("level") or 2)
            block["level"] = level if level in (1, 2, 3) else 2
        elif kind == "TEXT":
            block["text"] = str(entry.get("text") or "")[:8000]
        elif kind == "SPACER":
            size = str(entry.get("size") or "medium")
            block["size"] = size if size in documents.SPACER_POINTS else "medium"
        elif kind == "REPORT":
            reference = str(entry.get("report_id") or "").strip()
            if reference:
                # Parsed, not resolved: whether the reader may *see* that report
                # is decided when the document is rendered, by the endpoint that
                # owns it. A check here goes stale the moment its owner changes
                # the audience.
                block["report_id"] = str(parse_uuid(reference, field="report_id"))
            show = str(entry.get("show") or "both")
            block["show"] = show if show in SHOW_MODES else "both"
            block["caption"] = str(entry.get("caption") or "")[:200]
        elif kind == "CHART":
            entity = str(entry.get("entity") or "").strip()
            if entity:
                explorer.resource_for(entity, principal=principal)
                block["entity"] = entity
            chart = str(entry.get("chart") or "bar")
            block["chart"] = chart if chart in CHART_KINDS else "bar"
            for key in ("dimension", "granularity", "stack", "measure", "period"):
                value = str(entry.get(key) or "").strip()[:64]
                if value:
                    block[key] = value
            aggregation = str(entry.get("aggregation") or "count").strip()
            block["aggregation"] = aggregation[:16] or "count"
            show = str(entry.get("show") or "chart")
            block["show"] = show if show in SHOW_MODES else "chart"
            filters = entry.get("filters")
            if filters is not None and not isinstance(filters, dict):
                raise ValidationError("A chart block's filters must be an object.")
            block["filters"] = filters or {}
            block["caption"] = str(entry.get("caption") or "")[:200]
        elif kind == "TABLE":
            entity = str(entry.get("entity") or "").strip()
            if entity:
                explorer.resource_for(entity, principal=principal)
                block["entity"] = entity
            columns = entry.get("columns")
            if isinstance(columns, list):
                block["columns"] = [str(column)[:64] for column in columns][:12]
            filters = entry.get("filters")
            if filters is not None and not isinstance(filters, dict):
                raise ValidationError("A table block's filters must be an object.")
            block["filters"] = filters or {}
            block["sort"] = str(entry.get("sort") or "")[:64]
            block["order"] = "asc" if str(entry.get("order")) == "asc" else "desc"
            block["limit"] = min(
                MAX_TABLE_ROWS, max(1, int(entry.get("limit") or DEFAULT_TABLE_ROWS))
            )
            block["caption"] = str(entry.get("caption") or "")[:200]
        elif kind == "METRICS":
            entity = str(entry.get("entity") or "").strip()
            if entity:
                explorer.resource_for(entity, principal=principal)
                block["entity"] = entity
            metrics = entry.get("metrics")
            if isinstance(metrics, list):
                block["metrics"] = [str(key)[:64] for key in metrics][:6]
            filters = entry.get("filters")
            if filters is not None and not isinstance(filters, dict):
                raise ValidationError("A metrics block's filters must be an object.")
            block["filters"] = filters or {}
            block["caption"] = str(entry.get("caption") or "")[:200]

        out.append(block)
    return out


# ── plumbing ─────────────────────────────────────────────────────────────


def _visible(session, document_id: Any, principal) -> ReportDocument:
    principal.require(VIEW_PERMISSION)
    identifier = parse_uuid(document_id, field="document_id")
    row = session.scalars(
        select(ReportDocument)
        .options(selectinload(ReportDocument.owner))
        .where(
            ReportDocument.id == identifier,
            ReportDocument.deleted_at.is_(None),
            sharing.visibility(ReportDocument, KIND, principal),
        )
    ).unique().first()
    if row is None:
        # The same answer as "you may not see it": whether somebody else's
        # private document exists is itself information (§76).
        raise NotFoundError("That document does not exist.", details={"id": str(identifier)})
    return row


def _owned(session, document_id: Any, principal) -> ReportDocument:
    row = _visible(session, document_id, principal)
    sharing.require_owner(row, principal, kind=KIND)
    return row


# ── composing one automatically ──────────────────────────────────────────


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


def _period_label(period: str) -> str:
    """The window, written the way a cover page would say it."""
    return str(period).replace("_", " ").replace("last ", "The last ").strip().capitalize()


def _copy_name(session, name: str, principal) -> str:
    taken = set(session.scalars(
        select(ReportDocument.name).where(
            ReportDocument.owner_id == principal.user_id,
            ReportDocument.deleted_at.is_(None),
        )
    ).all())
    if name not in taken:
        return name[:200]
    for suffix in range(2, 100):
        candidate = f"{name} ({suffix})"[:200]
        if candidate not in taken:
            return candidate
    return f"{name} (copy)"[:200]


def _slug(name: str) -> str:
    cleaned = "".join(character if character.isalnum() else "-" for character in name.lower())
    return "-".join(part for part in cleaned.split("-") if part)[:120] or "document"


def _serialize(
    session, row: ReportDocument, principal, *, blocks: bool = True
) -> dict[str, Any]:
    owner = row.owner
    can_edit = row.owner_id == principal.user_id and principal.can(MANAGE_PERMISSION)
    out: dict[str, Any] = {
        "id": str(row.id),
        "name": row.name,
        "slug": row.slug,
        "description": row.description,
        "scope": row.scope,
        "page": {**DEFAULT_PAGE, **(row.page or {})},
        "owner": {
            "id": str(owner.id) if owner else "",
            "name": owner.full_name if owner else "",
            "email": owner.email if owner else None,
        },
        "can_edit": can_edit,
        "members": sharing.members(session, KIND, row.id) if can_edit else [],
        "block_count": len(row.blocks or []),
        # *What* it holds, so a card in a gallery says more than a number — the
        # same reason a dashboard card lists its widget kinds.
        "block_kinds": sorted({str(block.get("kind")) for block in (row.blocks or [])}),
        "render_count": int(row.render_count or 0),
        "last_rendered_at": row.last_rendered_at.isoformat() if row.last_rendered_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
    if blocks:
        out["blocks"] = [dict(block) for block in (row.blocks or [])]
    return out


def _state(row: ReportDocument) -> dict[str, Any]:
    return {
        "name": row.name,
        "scope": row.scope,
        "blocks": len(row.blocks or []),
        "page": dict(row.page or {}),
    }
