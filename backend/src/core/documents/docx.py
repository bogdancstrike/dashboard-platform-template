"""Rendering a document to DOCX."""

from __future__ import annotations

import io
from typing import Any, Iterable


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
