"""Rendering a document: every data block resolved, then written to a file."""

from __future__ import annotations

from typing import Any

from src.core import audit, documents
from src.core.clock import now
from src.core.errors import ValidationError
from src.models.personal import ReportDocument
from src.services.analytics.report_documents.charts import (
    _resolve_chart,
    _resolve_report,
)
from src.services.analytics.report_documents.serializers import _visible
from src.services.analytics.report_documents.tables import (
    _resolve_metrics,
    _resolve_table,
)
from src.services.analytics.report_documents.vocabulary import (
    DEFAULT_PAGE,
    FORMATS,
    KIND,
)


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
