"""Rendering a document to PDF with ReportLab's flowables.

Flowables rather than absolute placement, because a report is a *flow*: adding
a paragraph moves the table under it down. The header, footer and page number
are drawn on every page by one callback, the only part that knows about pages.
"""

from __future__ import annotations

import io
from typing import Any, Iterable

from reportlab.lib.pagesizes import A4, LETTER, landscape
from reportlab.lib.units import mm
from reportlab.platypus import BaseDocTemplate, Frame, PageBreak, PageTemplate, Paragraph, Spacer

from src.core.documents.docx import _escape
from src.core.documents.pdf_blocks import Frame as TextBox
from src.core.documents.pdf_blocks import flowables
from src.core.documents.pdf_styles import MUTED, RULE, styles_for


def _page_size(page: dict[str, Any]):
    size = A4 if page.get("size") != "LETTER" else LETTER
    return landscape(size) if page.get("orientation") == "landscape" else size


def _furniture(page: dict[str, Any], size, margin: float):
    header, footer = str(page.get("header") or ""), str(page.get("footer") or "")
    numbered = bool(page.get("page_numbers", True))

    def draw(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(MUTED)
        if header:
            canvas.drawString(doc.leftMargin, size[1] - margin + 6, header[:120])
            canvas.setStrokeColor(RULE)
            canvas.line(doc.leftMargin, size[1] - margin + 2, size[0] - doc.rightMargin, size[1] - margin + 2)
        if footer:
            canvas.drawString(doc.leftMargin, margin - 12, footer[:120])
        if numbered:
            canvas.drawRightString(size[0] - doc.rightMargin, margin - 12, str(doc.page))
        canvas.restoreState()

    return draw


def render_pdf(*, title: str, page: dict[str, Any], blocks: Iterable[dict[str, Any]]) -> bytes:
    """The document as a PDF."""
    size = _page_size(page)
    margin = float(page.get("margin_mm") or 20) * mm
    furnished_foot = bool(page.get("footer")) or bool(page.get("page_numbers", True))
    styles = styles_for(page)
    buffer = io.BytesIO()
    document = BaseDocTemplate(
        buffer, pagesize=size, leftMargin=margin, rightMargin=margin,
        # Room for the furniture, so a running header never lands on the text.
        topMargin=margin + (14 if page.get("header") else 0),
        bottomMargin=margin + (14 if furnished_foot else 0),
        title=title, author="", subject=str(page.get("subtitle") or ""),
    )
    frame = Frame(document.leftMargin, document.bottomMargin, document.width, document.height,
                  id="body", leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    document.addPageTemplates([PageTemplate(id="page", frames=[frame],
                                            onPage=_furniture(page, size, margin))])
    story: list[Any] = []
    if page.get("cover", True):
        story += [Spacer(1, document.height * 0.28), Paragraph(_escape(title), styles.cover_title)]
        if page.get("subtitle"):
            story += [Spacer(1, 10), Paragraph(_escape(str(page["subtitle"])), styles.cover_sub)]
        story.append(PageBreak())
    box = TextBox(styles=styles, width=document.width, height=document.height)
    for block in blocks:
        story += flowables(block, box)
    if not story:
        story.append(Paragraph("This document has no blocks yet.", styles.body))
    document.build(story)
    return buffer.getvalue()
