"""The paragraph styles a PDF document is set in, coloured by its accent."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet

MUTED = colors.HexColor("#64748b")
RULE = colors.HexColor("#e2e8f0")


@dataclass(frozen=True)
class Styles:
    accent: Any
    body: ParagraphStyle
    caption: ParagraphStyle
    note: ParagraphStyle
    cell: ParagraphStyle
    head_cell: ParagraphStyle
    headings: dict[int, ParagraphStyle]
    cover_title: ParagraphStyle
    cover_sub: ParagraphStyle


def styles_for(page: dict[str, Any]) -> Styles:
    accent = colors.HexColor(str(page.get("accent") or "#5b5bd6"))
    sheet = getSampleStyleSheet()
    body = ParagraphStyle("nu-body", parent=sheet["BodyText"], fontSize=10, leading=14.5)
    caption = ParagraphStyle("nu-caption", parent=body, fontSize=8.5, textColor=MUTED, spaceAfter=4)
    cell = ParagraphStyle("nu-cell", parent=body, fontSize=8.5, leading=11)
    return Styles(
        accent=accent,
        body=body,
        caption=caption,
        note=ParagraphStyle("nu-note", parent=caption, textColor=colors.HexColor("#b45309")),
        cell=cell,
        head_cell=ParagraphStyle("nu-head-cell", parent=cell, textColor=colors.white),
        headings={
            1: ParagraphStyle("nu-h1", parent=sheet["Heading1"], fontSize=18, spaceBefore=10,
                              spaceAfter=6, textColor=accent),
            2: ParagraphStyle("nu-h2", parent=sheet["Heading2"], fontSize=14, spaceBefore=10,
                              spaceAfter=4),
            3: ParagraphStyle("nu-h3", parent=sheet["Heading3"], fontSize=11.5, spaceBefore=8,
                              spaceAfter=3),
        },
        cover_title=ParagraphStyle("nu-cover-title", parent=sheet["Title"], fontSize=30, leading=36,
                                   alignment=TA_CENTER, textColor=accent),
        cover_sub=ParagraphStyle("nu-cover-sub", parent=body, fontSize=12, alignment=TA_CENTER,
                                 textColor=colors.HexColor("#475569")),
    )
