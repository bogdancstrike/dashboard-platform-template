"""Map Docling's structured text/tables to Nucleus' bounded ingest contract.

Every section keeps the page(s) it came from and, where Docling knows them, the
boxes it occupies — normalised to 0..1 with a top-left origin so the browser can
draw a highlight over a rendered page without knowing the PDF's point size.
"""
import math

from docling_core.types.doc import DocItemLabel, TableItem, TextItem


def boxes_of(item, document) -> list[dict]:
    """The item's provenance boxes, normalised to its page; empty when unknown."""
    out = []
    for prov in getattr(item, "prov", None) or []:
        page = document.pages.get(prov.page_no) if hasattr(document.pages, "get") else None
        size = getattr(page, "size", None)
        bbox = getattr(prov, "bbox", None)
        if not size or not bbox or not size.width or not size.height:
            continue
        box = bbox.to_top_left_origin(page_height=size.height)
        out.append({
            "page": prov.page_no,
            "x": round(max(0.0, box.l / size.width), 4),
            "y": round(max(0.0, box.t / size.height), 4),
            "w": round(min(1.0, (box.r - box.l) / size.width), 4),
            "h": round(min(1.0, (box.b - box.t) / size.height), 4),
        })
    return out[:20]


def extract(result):
    if result.status.value not in ("success", "partial_success"):
        return {"ok": False, "code": "FILE_PARSE_ERROR", "detail": "Docling could not convert this document."}
    document = result.document
    sections, tables, outline, heading = [], [], [], []
    text_size = 0
    for item, _level in document.iterate_items():
        before = len(sections)
        pages = [p.page_no for p in item.prov]
        page = min(pages) if pages else None
        last = max(pages) if pages else None
        if isinstance(item, TableItem):
            frame = item.export_to_dataframe(doc=document)
            if len(frame) > 1_000_000 or len(frame.columns) > 200 or len(tables) >= 50:
                return {"ok": False, "code": "FILE_LIMIT_EXCEEDED", "detail": "Document exceeds table, row or column limits."}
            header = [str(value) for value in frame.columns]
            rows = [[None if value is None or (isinstance(value, float) and math.isnan(value)) else str(value) for value in row]
                    for row in frame.itertuples(index=False, name=None)]
            tables.append({"name": f"table_{len(tables) + 1}", "header": header, "rows": rows, "page": page})
            sections.append({"kind": "table", "text": item.export_to_markdown(doc=document), "heading_path": list(heading),
                             "page_from": page, "page_to": last, "boxes": boxes_of(item, document)})
        elif isinstance(item, TextItem) and item.text.strip():
            if item.label in (DocItemLabel.TITLE, DocItemLabel.SECTION_HEADER):
                heading = heading[:max(0, getattr(item, "level", 1) - 1)] + [item.text]
                outline.append({"title": item.text, "page": page})
            sections.append({"kind": "text", "text": item.text, "heading_path": list(heading),
                             "page_from": page, "page_to": last, "boxes": boxes_of(item, document)})
        if len(sections) > before:
            text_size += len(sections[-1]["text"])
        if len(sections) > 10_000 or text_size > 10_000_000:
            return {"ok": False, "code": "FILE_LIMIT_EXCEEDED", "detail": "Document exceeds extracted text limits."}
    warnings = ["DOCLING_CPU"]
    if result.status.value == "partial_success":
        warnings.append("PARTIAL_CONVERSION")
    if not sections:
        warnings.append("NO_TEXT_EXTRACTED")
    return {"ok": True, "sections": sections, "tables": tables, "outline": outline, "warnings": warnings,
            "pages": len(document.pages) or None, "device": "cpu"}
