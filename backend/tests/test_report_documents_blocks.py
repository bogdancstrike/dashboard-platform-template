"""What each report-document block turns into, and what the files look like.

`test_report_documents` covers the CRUD and sharing. These pin the part a
reader sees: every block kind resolved against the seeded data — including the
honest degradations (no dataset chosen, a dataset the reader may not see, a
chart whose picture did not arrive, a table too wide for the page) — and the
PDF/DOCX writers given every kind of piece, on both paper sizes and
orientations.
"""

from __future__ import annotations

from tests.report_documents_support import (  # noqa: F401
    document,
)

import base64
import io
import zipfile
from types import SimpleNamespace

import pytest

from src.core import documents
from src.services.analytics import report_documents as docs
from tests.personas import PREFIX, as_each, principal

DOCUMENTS = f"{PREFIX}/api/report-documents"


def _png(width: int = 40, height: int = 20) -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (36, 87, 214)).save(buffer, format="PNG")
    return buffer.getvalue()


def _data_url(png: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png).decode()


EVERY_PIECE = [
    {"kind": "HEADING", "text": "Quarter <in> review & more", "level": 1},
    {"kind": "HEADING", "text": "Detail", "level": 3},
    {"kind": "TEXT", "text": "First paragraph.\nSecond line.\n\nAnother paragraph.\n\n   "},
    {"kind": "NOTE", "text": "[You cannot see orders]"},
    {"kind": "DIVIDER"},
    {"kind": "SPACER", "size": "small"},
    {"kind": "SPACER", "size": "large"},
    {"kind": "PAGE_BREAK"},
    {"kind": "IMAGE", "png": None},
    {"kind": "METRICS", "caption": "Headline", "items": [{"label": "Open", "value": "12"},
                                                         {"label": "Late", "value": "3"}]},
    {"kind": "METRICS", "items": []},
    {"kind": "TABLE", "caption": "Rows", "columns": ["A", "B"], "rows": [["1", "2"], ["3", "4"]],
     "note": "2 more columns"},
    {"kind": "TABLE", "columns": []},
]


@pytest.mark.parametrize("page", [
    {"size": "A4", "orientation": "portrait", "margin_mm": 20, "header": "Confidential",
     "footer": "Nucleus", "page_numbers": True, "cover": True, "subtitle": "Q3", "accent": "#2457D6"},
    {"size": "LETTER", "orientation": "landscape", "margin_mm": 12, "header": "", "footer": "",
     "page_numbers": False, "cover": False, "subtitle": "", "accent": "#000000"},
    {"size": "A4", "orientation": "portrait", "margin_mm": 20, "header": "", "footer": "",
     "page_numbers": True, "cover": True, "subtitle": "", "accent": "#2457D6"},
])
def test_both_writers_draw_every_kind_of_piece(page):
    blocks = [*EVERY_PIECE, {"kind": "IMAGE", "png": _png(), "caption": "A chart"},
              {"kind": "IMAGE", "png": _png(10, 10)}]

    pdf = documents.render_pdf(title="Quarterly <review>", page=page, blocks=blocks)
    assert pdf.startswith(b"%PDF") and len(pdf) > 1500

    docx = documents.render_docx(title="Quarterly review", page=page, blocks=blocks)
    with zipfile.ZipFile(io.BytesIO(docx)) as archive:
        xml = archive.read("word/document.xml").decode()
        assert len([n for n in archive.namelist() if n.startswith("word/media/")]) == 2
    assert "Quarter &lt;in&gt; review &amp; more" in xml and "Headline" in xml
    assert ("Quarterly review" in xml) == page["cover"]


def test_an_empty_document_still_makes_a_file():
    page = {**docs.DEFAULT_PAGE}
    assert documents.render_pdf(title="Empty", page={**page, "cover": False}, blocks=[]).startswith(b"%PDF")
    assert documents.render_docx(title="Empty", page=page, blocks=[])[:2] == b"PK"


def test_only_a_png_or_jpeg_data_url_is_a_picture():
    png = _png()
    assert documents.decode_png(_data_url(png)) == png
    assert documents.decode_png("data:image/png;base64,@@not base64@@") is None
    assert documents.decode_png("data:image/gif;base64,R0lGOD") is None
    assert documents.decode_png(None) is None and documents.decode_png(42) is None
    assert documents.filename("  Q3 / board review!  ", "pdf") == "q3-board-review.pdf"
    assert documents.filename("???", "docx") == "document.docx"
    columns, rows, dropped = documents.fit_columns(list("ABCDEFGH"), [list("12345678")], "portrait")
    assert columns == list("ABCDEF") and rows == [list("123456")] and dropped == 2
    assert documents.fit_columns(list("ABCDEFGH"), [list("12345678")], "landscape")[2] == 0


def test_numbers_and_cells_are_written_the_way_their_format_says():
    assert docs._metric({"value": 12.5, "format": "percent"}) == "12.5%"
    assert docs._metric({"value": 1234567, "format": "currency"}) == "1,234,567"
    assert docs._metric({"value": 2.25, "format": "hours"}) == "2.2"
    assert docs._metric({"value": 3, "format": "number"}) == "3"
    assert docs._metric({"value": 3.14159}) == "3.14"
    assert docs._metric({"value": "n/a"}) == "n/a"
    assert docs._number(None) == "" and docs._number("x") == "x" and docs._number(2.5) == "2.50"
    assert docs._cell(None) == "" and docs._cell(True) == "yes" and docs._cell(False) == "no"
    assert docs._cell(["a", "b"]) == "a, b" and docs._cell({"k": 1}) == "…" and docs._cell(7) == "7"
    assert docs._why("chart", ValueError("")) == "[this chart could not be read]"
    assert docs._measure_of({"aggregation": "sum", "measure": "amount"}) == {"aggregation": "sum", "field": "amount"}
    assert docs._measure_of({"aggregation": "sum"}) == {"aggregation": "count"}


def test_the_paper_is_clamped_not_refused():
    page = docs._page({"size": "tabloid", "orientation": "sideways", "margin_mm": "lots",
                       "accent": "blue", "header": "h" * 300, "page_numbers": 0, "cover": False})
    assert page["size"] == "A4" and page["orientation"] == "portrait"
    assert page["margin_mm"] == docs.DEFAULT_PAGE["margin_mm"]
    assert page["accent"] == docs.DEFAULT_PAGE["accent"] and len(page["header"]) == 160
    assert page["page_numbers"] is False and page["cover"] is False
    assert docs._page({"margin_mm": 400})["margin_mm"] == 50.0
    assert docs._page({"margin_mm": 1, "size": "letter", "orientation": "LANDSCAPE"}) | {} == {
        **docs._page({"margin_mm": 1, "size": "letter", "orientation": "LANDSCAPE"})}
    assert docs._page(None)["size"] == "A4"


# ── resolving blocks against the seeded data ──────────────────────────────


def _first_report_id(session) -> str | None:
    from sqlalchemy import select

    from src.models.personal import Report

    return session.scalar(select(Report.id).where(Report.deleted_at.is_(None), Report.scope == "PUBLIC").limit(1))


@pytest.mark.database
def test_every_block_kind_resolves_or_says_why_not(app):
    from src.core.db import session_scope

    admin = principal(app, "admin")
    png = _png()
    with session_scope() as session:
        report_id = _first_report_id(session)
        from src.services.records import explorer

        fields = explorer.run(session, {"resource_type": "task", "page_size": 1}, principal=admin)["fields"]
        wide = [field["name"] for field in fields][:8]
        blocks = [
            {"id": "h", "kind": "HEADING", "text": "  Title  ", "level": 1},
            {"id": "e", "kind": "TEXT", "text": "   "},
            {"id": "d", "kind": "DIVIDER"}, {"id": "p", "kind": "PAGE_BREAK"}, {"id": "s", "kind": "SPACER"},
            {"id": "r0", "kind": "REPORT"},
            {"id": "r1", "kind": "REPORT", "report_id": "00000000-0000-0000-0000-000000000000"},
            {"id": "c0", "kind": "CHART"},
            {"id": "c1", "kind": "CHART", "entity": "task", "dimension": "no_such_field"},
            {"id": "c2", "kind": "CHART", "entity": "task", "dimension": "status", "show": "chart"},
            {"id": "c3", "kind": "CHART", "entity": "task", "dimension": "status", "show": "both",
             "stack": "priority", "caption": "Tasks"},
            {"id": "c4", "kind": "CHART", "entity": "task", "dimension": "status", "show": "chart"},
            {"id": "c5", "kind": "CHART", "entity": "task", "dimension": "status",
             "filters": {"status": "NO_SUCH_STATUS"}},
            {"id": "t0", "kind": "TABLE"},
            {"id": "t1", "kind": "TABLE", "entity": "nowhere"},
            {"id": "t2", "kind": "TABLE", "entity": "task", "limit": 3, "columns": wide},
            {"id": "t3", "kind": "TABLE", "entity": "task", "filters": {"status": "NO_SUCH_STATUS"}},
            {"id": "m0", "kind": "METRICS"},
            {"id": "m1", "kind": "METRICS", "entity": "nowhere"},
            {"id": "m2", "kind": "METRICS", "entity": "task", "caption": "Now"},
            {"id": "m3", "kind": "METRICS", "entity": "task", "metrics": ["no_such_metric"]},
        ]
        if report_id:
            blocks += [
                {"id": "r2", "kind": "REPORT", "report_id": str(report_id), "show": "both"},
                {"id": "r3", "kind": "REPORT", "report_id": str(report_id), "show": "chart"},
                {"id": "r4", "kind": "REPORT", "report_id": str(report_id), "show": "chart", "caption": "Mine"},
            ]
        images = {"c2": _data_url(png), "c3": _data_url(png), "r2": _data_url(png), "r4": _data_url(png),
                  "c4": "data:image/png;base64,broken"}
        out = docs.resolve(session, SimpleNamespace(blocks=blocks), principal=admin,
                           images=images, orientation="portrait")
        session.rollback()

    kinds = [piece["kind"] for piece in out]
    texts = " | ".join(str(piece.get("text", "")) for piece in out)
    assert out[0] == {"kind": "HEADING", "text": "Title", "level": 1}
    assert {"kind": "DIVIDER"} in out and {"kind": "PAGE_BREAK"} in out
    assert {"kind": "SPACER", "size": "medium"} in out
    for sentence in ("A report block with no report chosen.", "A chart block with no dataset chosen.",
                     "A table block with no dataset chosen.", "A metrics block with no dataset chosen.",
                     "This chart matched nothing.", "Nothing in task matched this block.",
                     "task declares no headline numbers.",
                     "The chart could not be captured, so its numbers are below."):
        assert sentence in texts, sentence
    assert texts.count("[") >= 4  # the reasons, in brackets: bad report, field, dataset ×2
    assert kinds.count("IMAGE") == (4 if report_id else 2)
    tables = [piece for piece in out if piece["kind"] == "TABLE"]
    narrowed = next(piece for piece in tables if len(piece["columns"]) == 6 and len(piece["rows"]) == 3)
    assert "2 more columns" in narrowed["note"] and "3 of" in narrowed["note"]
    metrics = next(piece for piece in out if piece["kind"] == "METRICS")
    assert metrics["caption"] == "Now" and 0 < len(metrics["items"]) <= 4


@pytest.mark.database
def test_a_reader_without_the_dataset_gets_a_reason_not_the_rows(app):
    """A reader whose role lacks the dataset: the block says so instead of failing the file.

    Every seeded persona can read every dataset, so the role is narrowed here —
    the shape of a custom role an administrator made without records access.
    """
    from dataclasses import replace

    from src.core.db import session_scope
    from src.services.records.explorer import resources

    viewer = principal(app, "user")
    needed = resources()["order"].permission
    reader = replace(viewer, permissions=frozenset(p for p in viewer.permissions if p != needed))
    with session_scope() as session:
        out = docs.resolve(session, SimpleNamespace(blocks=[
            {"id": "t", "kind": "TABLE", "entity": "order"},
            {"id": "m", "kind": "METRICS", "entity": "order"},
            {"id": "c", "kind": "CHART", "entity": "order", "dimension": "status"},
        ]), principal=reader, images={}, orientation="landscape")
        session.rollback()
    assert [piece["kind"] for piece in out] == ["NOTE", "NOTE", "NOTE"]
    assert all(piece["text"].startswith("[") for piece in out)


# ── through the API ──────────────────────────────────────────────────────


@pytest.mark.database
def test_the_api_refuses_what_it_cannot_render(client, monkeypatch):
    headers = as_each(monkeypatch)
    admin = headers("admin")
    bad = [
        {"name": "  "},
        {"name": "x", "page": "A4"},
        {"name": "x", "blocks": "all of them"},
        {"name": "x", "blocks": [{"kind": "TEXT"}] * (docs.MAX_BLOCKS + 1)},
        {"name": "x", "blocks": ["text"]},
        {"name": "x", "blocks": [{"kind": "VIDEO"}]},
        {"name": "x", "blocks": [{"kind": "CHART", "filters": []}]},
        {"name": "x", "blocks": [{"kind": "TABLE", "filters": "x"}]},
        {"name": "x", "blocks": [{"kind": "METRICS", "filters": 1}]},
        {"name": "x", "blocks": [{"kind": "REPORT", "report_id": "not-a-uuid"}]},
    ]
    for body in bad:
        response = client.post(DOCUMENTS, json=body, headers=admin)
        assert response.status_code == 400, (body, response.get_json())
    assert client.post(DOCUMENTS, data="[]", headers={**admin, "Content-Type": "application/json"}).status_code == 400


@pytest.mark.database
def test_a_document_round_trip_normalises_its_blocks_and_renders_both_formats(client, monkeypatch):
    headers = as_each(monkeypatch)
    admin = headers("admin")
    created = client.post(DOCUMENTS, json={
        "name": "Coverage review", "description": "  for the board  ",
        "page": {"orientation": "landscape", "size": "LETTER", "header": "Draft"},
        "blocks": [
            {"kind": "heading", "text": "Hello", "level": 7},
            {"kind": "TEXT", "text": "Body"},
            {"kind": "SPACER", "size": "huge"},
            {"kind": "REPORT", "show": "sideways"},
            {"kind": "CHART", "entity": "task", "chart": "zigzag", "dimension": "status", "aggregation": "",
             "show": "nope", "period": "this_month"},
            {"kind": "TABLE", "entity": "task", "columns": ["reference", "title"], "order": "asc", "limit": 9999},
            {"kind": "METRICS", "entity": "task", "metrics": ["open"]},
            {"kind": "DIVIDER"},
        ],
    }, headers=admin)
    assert created.status_code == 201, created.get_json()
    document = created.get_json()
    try:
        blocks = document["blocks"]
        assert blocks[0]["kind"] == "HEADING" and blocks[0]["level"] == 2
        assert blocks[2]["size"] == "medium" and blocks[3]["show"] == "both"
        assert blocks[4]["chart"] == "bar" and blocks[4]["show"] == "chart" and blocks[4]["aggregation"] == "count"
        assert blocks[5]["order"] == "asc" and blocks[5]["limit"] == docs.MAX_TABLE_ROWS
        assert document["description"] == "for the board"

        for fmt, magic in (("pdf", b"%PDF"), ("docx", b"PK")):
            rendered = client.post(f"{DOCUMENTS}/{document['id']}/render",
                                   json={"format": fmt, "images": {blocks[4]["id"]: _data_url(_png())}},
                                   headers=admin)
            assert rendered.status_code == 200, rendered.get_data(as_text=True)[:300]
            assert rendered.data.startswith(magic)
            assert rendered.headers["Content-Disposition"].endswith(f'coverage-review.{fmt}"')
        assert client.post(f"{DOCUMENTS}/{document['id']}/render", json={"format": "odt"},
                           headers=admin).status_code == 400
        assert client.post(f"{DOCUMENTS}/{document['id']}/render", json={"format": "pdf", "images": []},
                           headers=admin).status_code == 400
        again = client.get(f"{DOCUMENTS}/{document['id']}", headers=admin).get_json()
        assert again["render_count"] == 2

        # Clearing the description, and a copy of a copy is numbered.
        cleared = client.put(f"{DOCUMENTS}/{document['id']}", json={"description": ""}, headers=admin)
        assert cleared.status_code == 200 and cleared.get_json()["description"] is None
        first = client.post(f"{DOCUMENTS}/{document['id']}/duplicate", headers=admin).get_json()
        second = client.post(f"{DOCUMENTS}/{document['id']}/duplicate", headers=admin).get_json()
        assert first["name"] != second["name"] and first["scope"] == "PRIVATE"

        # Somebody who may read reports but not manage documents.
        analyst = headers("user")
        assert client.post(DOCUMENTS, json={"name": "Mine"}, headers=analyst).status_code in (403, 404)
        assert client.put(f"{DOCUMENTS}/{document['id']}", json={"name": "x"},
                            headers=analyst).status_code in (403, 404)
        assert client.delete(f"{DOCUMENTS}/{document['id']}", headers=analyst).status_code in (403, 404)
        assert client.get(f"{DOCUMENTS}/{document['id']}", headers=analyst).status_code == 404

        removed = client.delete(f"{DOCUMENTS}/{document['id']}", headers=admin)
        assert removed.status_code == 200 and removed.get_json()["deleted"] is True
        assert client.get(f"{DOCUMENTS}/{document['id']}", headers=admin).status_code == 404
    finally:
        pass
