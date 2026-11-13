"""One writer per block kind (strategy table): a block in, ReportLab flowables out."""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Any, Callable

from reportlab.lib import colors
from reportlab.platypus import HRFlowable, Image, PageBreak, Paragraph, Spacer, Table, TableStyle

from src.core.documents.docx import _escape
from src.core.documents.layout import SPACER_POINTS
from src.core.documents.pdf_styles import RULE, Styles


@dataclass(frozen=True)
class Frame:
    """What a writer needs to know about the page: styles and the text box."""

    styles: Styles
    width: float
    height: float


def _caption(block: dict[str, Any], key: str, frame: Frame) -> list[Any]:
    return [Paragraph(_escape(str(block[key])), frame.styles.caption)] if block.get(key) else []


def heading(block, frame: Frame) -> list[Any]:
    level = int(block.get("level") or 2)
    style = frame.styles.headings.get(level, frame.styles.headings[2])
    return [Paragraph(_escape(block.get("text", "")), style)]


def text(block, frame: Frame) -> list[Any]:
    out: list[Any] = []
    for chunk in str(block.get("text", "")).split("\n\n"):
        if chunk.strip():
            out += [Paragraph(_escape(chunk).replace("\n", "<br/>"), frame.styles.body), Spacer(1, 4)]
    return out


def image(block, frame: Frame) -> list[Any]:
    png = block.get("png")
    if not png:
        return []
    picture = Image(io.BytesIO(png))
    # Scaled to the text width, keeping the aspect the browser drew it at, and
    # no taller than the frame (taller is a LayoutError: the export failed).
    ratio = picture.imageHeight / picture.imageWidth if picture.imageWidth else 0.5
    picture.drawWidth, picture.drawHeight = frame.width, frame.width * ratio
    tallest = frame.height * 0.85
    if picture.drawHeight > tallest:
        picture.drawWidth *= tallest / picture.drawHeight
        picture.drawHeight = tallest
    return [picture, *_caption(block, "caption", frame), Spacer(1, 8)]


def metrics(block, frame: Frame) -> list[Any]:
    items = block.get("items") or []
    if not items:
        return []
    cells = [[Paragraph(f"<b>{_escape(item['value'])}</b><br/>{_escape(item['label'])}",
                        frame.styles.cell) for item in items]]
    table = Table(cells, colWidths=[frame.width / len(items)] * len(items))
    table.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, RULE), ("INNERGRID", (0, 0), (-1, -1), 0.5, RULE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8), ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ]))
    return [*_caption(block, "caption", frame), table, Spacer(1, 10)]


def table(block, frame: Frame) -> list[Any]:
    columns, rows = block.get("columns") or [], block.get("rows") or []
    if not columns:
        return []
    s = frame.styles
    data = [[Paragraph(f"<b>{_escape(name)}</b>", s.head_cell) for name in columns]]
    data += [[Paragraph(_escape(value), s.cell) for value in row] for row in rows]
    grid = Table(data, colWidths=[frame.width / len(columns)] * len(columns), repeatRows=1)
    grid.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), s.accent),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f8fafc")]),
        ("GRID", (0, 0), (-1, -1), 0.4, RULE), ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return [*_caption(block, "caption", frame), grid, *_caption(block, "note", frame), Spacer(1, 10)]


WRITERS: dict[str, Callable[[dict[str, Any], Frame], list[Any]]] = {
    "HEADING": heading,
    "TEXT": text,
    "NOTE": lambda block, frame: [Paragraph(_escape(block.get("text", "")), frame.styles.note)],
    "DIVIDER": lambda block, frame: [Spacer(1, 6), HRFlowable(width="100%", color=RULE), Spacer(1, 6)],
    "SPACER": lambda block, frame: [Spacer(1, SPACER_POINTS.get(str(block.get("size")), 20))],
    "PAGE_BREAK": lambda block, frame: [PageBreak()],
    "IMAGE": image,
    "METRICS": metrics,
    "TABLE": table,
}


def flowables(block: dict[str, Any], frame: Frame) -> list[Any]:
    """What one block draws; an unknown kind draws nothing."""
    writer = WRITERS.get(block.get("kind"))
    return writer(block, frame) if writer else []
