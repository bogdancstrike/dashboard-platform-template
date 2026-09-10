"""Turning a composed document into a file somebody can send (§28, §30).

This module knows about *paper*: page sizes, margins, running headers, page
numbers, where a heading sits and how a table is ruled. It knows nothing about
where the numbers came from — `services/report_documents` resolves every block
into plain content first, and hands this a list of pieces to lay out. The
split is what lets the PDF and the DOCX be two renderings of one document
rather than two documents that happen to agree today.

Three decisions worth stating.

**Charts arrive as images the client already drew.** There is no chart engine
in this process and adding one would be a second implementation of every
picture the product draws — different fonts, different colours, and a legend
that disagrees with the screen. The browser has already rendered the chart
with ECharts; it posts the PNG with the render request, and what lands in the
document is exactly what was previewed. A block whose image did not arrive
falls back to its own data as a table, which is the honest degradation: the
numbers are the point and the picture was the presentation of them.

**A table too wide for the page is narrowed by dropping columns, not by
shrinking type.** Six-point text is not a smaller table, it is an unreadable
one; a document that says "4 more columns" tells the reader what it did.

**Nothing here raises on missing content.** A block pointing at a report that
was deleted renders as a line saying so. A render that fails halfway is worse
than a document with one honest gap in it, because the person exporting it is
usually about to send it to somebody.
"""

from __future__ import annotations

import base64
import io
import re
from typing import Any, Iterable

# ── the shapes this lays out ─────────────────────────────────────────────
#
# A resolved block: everything needed to draw it, and nothing that needs a
# database. `services/report_documents` produces these.
#
#   {"kind": "HEADING",  "text": str, "level": 1 | 2 | 3}
#   {"kind": "TEXT",     "text": str}
#   {"kind": "IMAGE",    "png": bytes, "caption": str}
#   {"kind": "TABLE",    "caption": str, "columns": [str], "rows": [[str]],
#                        "dropped": int, "note": str}
#   {"kind": "METRICS",  "caption": str, "items": [{"label": str, "value": str}]}
#   {"kind": "DIVIDER"}
#   {"kind": "SPACER",   "size": "small" | "medium" | "large"}
#   {"kind": "PAGE_BREAK"}
#   {"kind": "NOTE",     "text": str}      — something could not be resolved

PAGE_SIZES = {"A4": "A4", "LETTER": "LETTER"}

#: How much vertical room a spacer asks for, in points.
SPACER_POINTS = {"small": 8, "medium": 20, "large": 40}

#: Columns past this and a portrait page is a grid of truncated words.
MAX_TABLE_COLUMNS = {"portrait": 6, "landscape": 9}


def content_type(fmt: str) -> str:
    return {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }[fmt]


def filename(stem: str, fmt: str) -> str:
    """A file name that survives being downloaded on any of three systems."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", stem).strip("-").lower() or "document"
    return f"{cleaned[:80]}.{fmt}"


def decode_png(value: Any) -> bytes | None:
    """A `data:` URL from the browser, as bytes.

    Returns `None` rather than raising for anything that is not a PNG data
    URL: an image that did not arrive is a block that renders as a table, and
    a malformed one is the same situation with a worse cause.
    """
    if not isinstance(value, str):
        return None
    match = re.match(r"^data:image/(png|jpeg);base64,(.+)$", value.strip(), re.DOTALL)
    if not match:
        return None
    try:
        return base64.b64decode(match.group(2), validate=True)
    except Exception:
        return None


def fit_columns(columns: list[str], rows: list[list[str]], orientation: str) -> tuple[
    list[str], list[list[str]], int
]:
    """The first few columns, and how many were left behind.

    Dropping columns rather than shrinking the type: six-point text is not a
    smaller table, and the reader is told the number so they know the document
    is a summary of a wider set.
    """
    limit = MAX_TABLE_COLUMNS.get(orientation, 6)
    if len(columns) <= limit:
        return columns, rows, 0
    return columns[:limit], [row[:limit] for row in rows], len(columns) - limit


# ── PDF ──────────────────────────────────────────────────────────────────


def render_pdf(*, title: str, page: dict[str, Any], blocks: Iterable[dict[str, Any]]) -> bytes:
    """The document as a PDF, laid out by ReportLab's flowable machinery.

    Flowables rather than absolute placement, because a report is a *flow*:
    somebody adding a paragraph expects the table under it to move down, not
    to be overlapped. The running header, the footer and the page number are
    drawn on every page by the same callback, which is the only part that
    knows about pages at all.
    """
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4, LETTER, landscape
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        BaseDocTemplate,
        Frame,
        HRFlowable,
        Image,
        PageBreak,
        PageTemplate,
        Paragraph,
        Spacer,
        Table,
        TableStyle,
    )

    size = landscape(A4 if page.get("size") != "LETTER" else LETTER) \
        if page.get("orientation") == "landscape" \
        else (A4 if page.get("size") != "LETTER" else LETTER)
    margin = float(page.get("margin_mm") or 20) * mm
    accent = colors.HexColor(str(page.get("accent") or "#5b5bd6"))
    header_text = str(page.get("header") or "")
    footer_text = str(page.get("footer") or "")
    numbered = bool(page.get("page_numbers", True))

    sheet = getSampleStyleSheet()
    body = ParagraphStyle("nu-body", parent=sheet["BodyText"], fontSize=10, leading=14.5)
    caption = ParagraphStyle(
        "nu-caption", parent=body, fontSize=8.5, textColor=colors.HexColor("#64748b"),
        spaceAfter=4,
    )
    note = ParagraphStyle("nu-note", parent=caption, textColor=colors.HexColor("#b45309"))
    cell = ParagraphStyle("nu-cell", parent=body, fontSize=8.5, leading=11)
    head_cell = ParagraphStyle("nu-head-cell", parent=cell, textColor=colors.white)
    headings = {
        1: ParagraphStyle("nu-h1", parent=sheet["Heading1"], fontSize=18, spaceBefore=10,
                          spaceAfter=6, textColor=accent),
        2: ParagraphStyle("nu-h2", parent=sheet["Heading2"], fontSize=14, spaceBefore=10,
                          spaceAfter=4),
        3: ParagraphStyle("nu-h3", parent=sheet["Heading3"], fontSize=11.5, spaceBefore=8,
                          spaceAfter=3),
    }
    cover_title = ParagraphStyle(
        "nu-cover-title", parent=sheet["Title"], fontSize=30, leading=36, alignment=TA_CENTER,
        textColor=accent,
    )
    cover_sub = ParagraphStyle(
        "nu-cover-sub", parent=body, fontSize=12, alignment=TA_CENTER,
        textColor=colors.HexColor("#475569"),
    )

    buffer = io.BytesIO()
    document = BaseDocTemplate(
        buffer, pagesize=size,
        leftMargin=margin, rightMargin=margin,
        # Room for the furniture, so a running header never lands on the first
        # line of text.
        topMargin=margin + (14 if header_text else 0),
        bottomMargin=margin + (14 if (footer_text or numbered) else 0),
        title=title, author="", subject=str(page.get("subtitle") or ""),
    )
    frame = Frame(
        document.leftMargin, document.bottomMargin,
        document.width, document.height, id="body",
        leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0,
    )

    def furniture(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#64748b"))
        if header_text:
            canvas.drawString(doc.leftMargin, size[1] - margin + 6, header_text[:120])
            canvas.setStrokeColor(colors.HexColor("#e2e8f0"))
            canvas.line(doc.leftMargin, size[1] - margin + 2,
                        size[0] - doc.rightMargin, size[1] - margin + 2)
        if footer_text:
            canvas.drawString(doc.leftMargin, margin - 12, footer_text[:120])
        if numbered:
            canvas.drawRightString(size[0] - doc.rightMargin, margin - 12, str(doc.page))
        canvas.restoreState()

    document.addPageTemplates([PageTemplate(id="page", frames=[frame], onPage=furniture)])

    story: list[Any] = []
    if page.get("cover", True):
        story.append(Spacer(1, document.height * 0.28))
        story.append(Paragraph(_escape(title), cover_title))
        if page.get("subtitle"):
            story.append(Spacer(1, 10))
            story.append(Paragraph(_escape(str(page["subtitle"])), cover_sub))
        story.append(PageBreak())

    available = document.width

    for block in blocks:
        kind = block.get("kind")
        if kind == "HEADING":
            level = int(block.get("level") or 2)
            story.append(Paragraph(_escape(block.get("text", "")), headings.get(level, headings[2])))
        elif kind == "TEXT":
            for chunk in str(block.get("text", "")).split("\n\n"):
                if chunk.strip():
                    story.append(Paragraph(_escape(chunk).replace("\n", "<br/>"), body))
                    story.append(Spacer(1, 4))
        elif kind == "NOTE":
            story.append(Paragraph(_escape(block.get("text", "")), note))
        elif kind == "DIVIDER":
            story.append(Spacer(1, 6))
            story.append(HRFlowable(width="100%", color=colors.HexColor("#e2e8f0")))
            story.append(Spacer(1, 6))
        elif kind == "SPACER":
            story.append(Spacer(1, SPACER_POINTS.get(str(block.get("size")), 20)))
        elif kind == "PAGE_BREAK":
            story.append(PageBreak())
        elif kind == "IMAGE":
            png = block.get("png")
            if png:
                image = Image(io.BytesIO(png))
                # Scaled to the text width, keeping the aspect the browser drew
                # it at — a chart squashed to fit is a chart that misreports its
                # own trend.
                ratio = image.imageHeight / image.imageWidth if image.imageWidth else 0.5
                image.drawWidth = available
                image.drawHeight = available * ratio
                story.append(image)
                if block.get("caption"):
                    story.append(Paragraph(_escape(str(block["caption"])), caption))
                story.append(Spacer(1, 8))
        elif kind == "METRICS":
            items = block.get("items") or []
            if items:
                if block.get("caption"):
                    story.append(Paragraph(_escape(str(block["caption"])), caption))
                data = [
                    [Paragraph(f"<b>{_escape(item['value'])}</b><br/>{_escape(item['label'])}", cell)
                     for item in items]
                ]
                table = Table(data, colWidths=[available / len(items)] * len(items))
                table.setStyle(TableStyle([
                    ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e2e8f0")),
                    ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                    ("TOPPADDING", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ]))
                story.append(table)
                story.append(Spacer(1, 10))
        elif kind == "TABLE":
            columns = block.get("columns") or []
            rows = block.get("rows") or []
            if columns:
                if block.get("caption"):
                    story.append(Paragraph(_escape(str(block["caption"])), caption))
                data = [[Paragraph(f"<b>{_escape(name)}</b>", head_cell) for name in columns]]
                data += [[Paragraph(_escape(value), cell) for value in row] for row in rows]
                table = Table(
                    data, colWidths=[available / len(columns)] * len(columns), repeatRows=1,
                )
                table.setStyle(TableStyle([
                    ("BACKGROUND", (0, 0), (-1, 0), accent),
                    ("ROWBACKGROUNDS", (0, 1), (-1, -1),
                     [colors.white, colors.HexColor("#f8fafc")]),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                    ("LEFTPADDING", (0, 0), (-1, -1), 5),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 5),
                ]))
                story.append(table)
                if block.get("note"):
                    story.append(Paragraph(_escape(str(block["note"])), caption))
                story.append(Spacer(1, 10))

    if not story:
        story.append(Paragraph("This document has no blocks yet.", body))

    document.build(story)
    return buffer.getvalue()


def _escape(value: Any) -> str:
    """Text as ReportLab's mini-markup will read it.

    Paragraph parses a subset of XML, so a customer called `Smith & Sons` ends
    a build with a parse error rather than a document. Escaped here, once,
    rather than trusted at thirty call sites.
    """
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


# ── DOCX ─────────────────────────────────────────────────────────────────


def render_docx(*, title: str, page: dict[str, Any], blocks: Iterable[dict[str, Any]]) -> bytes:
    """The same document as a Word file.

    Word owns its own pagination, so this describes *structure* — headings,
    paragraphs, tables, a running header and footer — and lets Word decide
    where pages fall. Trying to reproduce the PDF's exact breaks would produce
    a file full of manual breaks that a reader could not edit, which is the
    whole reason somebody asked for DOCX rather than PDF.
    """
    from docx import Document
    from docx.enum.section import WD_ORIENT
    from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
    from docx.shared import Mm, Pt, RGBColor

    document = Document()
    section = document.sections[0]

    if str(page.get("size")) == "LETTER":
        section.page_width, section.page_height = Mm(215.9), Mm(279.4)
    else:
        section.page_width, section.page_height = Mm(210), Mm(297)
    if page.get("orientation") == "landscape":
        section.orientation = WD_ORIENT.LANDSCAPE
        section.page_width, section.page_height = section.page_height, section.page_width

    margin = Mm(float(page.get("margin_mm") or 20))
    section.left_margin = section.right_margin = margin
    section.top_margin = section.bottom_margin = margin

    if page.get("header"):
        header = section.header.paragraphs[0]
        header.text = str(page["header"])[:120]
        _quiet(header, RGBColor(0x64, 0x74, 0x8B), Pt(8))
    # The footer carries the page number as a field, so Word renumbers it when
    # the document is edited. A literal "1" would be wrong the moment somebody
    # added a paragraph.
    if page.get("footer") or page.get("page_numbers", True):
        footer = section.footer.paragraphs[0]
        footer.text = str(page.get("footer") or "")[:120]
        _quiet(footer, RGBColor(0x64, 0x74, 0x8B), Pt(8))
        if page.get("page_numbers", True):
            footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT if not page.get("footer") else footer.alignment
            _page_number_field(footer)

    if page.get("cover", True):
        heading = document.add_paragraph()
        heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
        run = heading.add_run(title)
        run.bold = True
        run.font.size = Pt(30)
        if page.get("subtitle"):
            sub = document.add_paragraph()
            sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
            sub_run = sub.add_run(str(page["subtitle"]))
            sub_run.font.size = Pt(12)
            sub_run.font.color.rgb = RGBColor(0x47, 0x55, 0x69)
        document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)

    for block in blocks:
        kind = block.get("kind")
        if kind == "HEADING":
            document.add_heading(str(block.get("text", "")), level=int(block.get("level") or 2))
        elif kind == "TEXT":
            for chunk in str(block.get("text", "")).split("\n\n"):
                if chunk.strip():
                    document.add_paragraph(chunk.strip())
        elif kind == "NOTE":
            paragraph = document.add_paragraph()
            run = paragraph.add_run(str(block.get("text", "")))
            run.italic = True
            run.font.color.rgb = RGBColor(0xB4, 0x53, 0x09)
        elif kind == "DIVIDER":
            document.add_paragraph("─" * 40)
        elif kind == "SPACER":
            for _ in range(1 if str(block.get("size")) == "small" else 2):
                document.add_paragraph()
        elif kind == "PAGE_BREAK":
            document.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        elif kind == "IMAGE" and block.get("png"):
            width = section.page_width - section.left_margin - section.right_margin
            document.add_picture(io.BytesIO(block["png"]), width=width)
            if block.get("caption"):
                _caption(document, str(block["caption"]))
        elif kind == "METRICS" and block.get("items"):
            items = block["items"]
            if block.get("caption"):
                _caption(document, str(block["caption"]))
            table = document.add_table(rows=2, cols=len(items))
            table.style = "Light Grid Accent 1"
            for index, item in enumerate(items):
                value = table.cell(0, index).paragraphs[0]
                value_run = value.add_run(str(item["value"]))
                value_run.bold = True
                value_run.font.size = Pt(16)
                table.cell(1, index).text = str(item["label"])
        elif kind == "TABLE" and block.get("columns"):
            columns = block["columns"]
            rows = block.get("rows") or []
            if block.get("caption"):
                _caption(document, str(block["caption"]))
            table = document.add_table(rows=1, cols=len(columns))
            table.style = "Light Grid Accent 1"
            for index, name in enumerate(columns):
                cell = table.rows[0].cells[index]
                cell.text = ""
                run = cell.paragraphs[0].add_run(str(name))
                run.bold = True
            for row in rows:
                cells = table.add_row().cells
                for index, value in enumerate(row):
                    cells[index].text = str(value)
            if block.get("note"):
                _caption(document, str(block["note"]))
            document.add_paragraph()

    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def _quiet(paragraph, colour, size) -> None:
    for run in paragraph.runs:
        run.font.size = size
        run.font.color.rgb = colour


def _caption(document, text: str) -> None:
    from docx.shared import Pt, RGBColor

    paragraph = document.add_paragraph()
    run = paragraph.add_run(text)
    run.font.size = Pt(8.5)
    run.font.color.rgb = RGBColor(0x64, 0x74, 0x8B)


def _page_number_field(paragraph) -> None:
    """`PAGE` as a Word field, so the number is computed rather than typed."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    run = paragraph.add_run(" ")
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    instruction = OxmlElement("w:instrText")
    instruction.set(qn("xml:space"), "preserve")
    instruction.text = "PAGE"
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(begin)
    run._r.append(instruction)
    run._r.append(end)
