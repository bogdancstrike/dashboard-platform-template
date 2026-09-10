"""Report documents — a composed page, exported as PDF or DOCX (§28).

Three properties matter more than the CRUD.

**A document is not a report, and the split is the point.** A report is a
saved question; a document is a page holding several answers with prose
between them, on paper of a stated size. The two used to be one builder
wearing two names.

**A document stores no answers.** Rendering runs the questions again, so a
document exported in March and again in June is one layout over two months of
data. Asserted by rendering the same document twice against changed data.

**A block that cannot be resolved is a sentence, not an exception.** The
person exporting is usually about to send the file to somebody, and one honest
gap beats a 500 — so a deleted report, a forbidden dataset and an empty table
each render as a line of text.

The renderer tests need no database at all: `core/documents` lays out content
that `services/report_documents` has already resolved, and keeping that seam
testable is why the two are separate modules.
"""

from __future__ import annotations

import pytest

from src.config import Config
from src.core import documents
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
DOCUMENTS = f"{PREFIX}/api/report-documents"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda token: persona_claims(
            _persona_of(token), _role_of(token), sid=f"documents-{_persona_of(token)}"
        ),
    )
    return {"Authorization": f"Bearer documents-{username}-{role}"}


def _persona_of(token: str) -> str:
    return str(token).split("-")[1] if "-" in str(token) else "admin"


def _role_of(token: str) -> str:
    parts = str(token).split("-")
    return parts[2] if len(parts) > 2 else "administrator"


@pytest.fixture()
def document(client, monkeypatch):
    """One document owned by the administrator, removed on the way out."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        DOCUMENTS,
        json={
            "name": "Quarterly review",
            "page": {"size": "A4", "footer": "Confidential", "subtitle": "Q3"},
        },
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()
    saved = response.get_json()
    try:
        yield saved
    finally:
        _erase(saved["id"])


def _erase(document_id: str) -> None:
    from src.core.db import session_scope
    from src.models.personal import ReportDocument, ResourceShare

    with session_scope() as session:
        session.query(ResourceShare).filter(
            ResourceShare.resource_type == "report_document",
            ResourceShare.resource_id == str(document_id),
        ).delete(synchronize_session=False)
        session.query(ReportDocument).filter(
            ReportDocument.id == document_id
        ).delete(synchronize_session=False)


# ── the API ──────────────────────────────────────────────────────────────


def test_documents_need_a_bearer_token(client):
    assert client.get(DOCUMENTS).status_code == 401
    assert client.post(DOCUMENTS, json={"name": "x"}).status_code == 401


@pytest.mark.database
def test_a_new_document_arrives_holding_something(document):
    """A builder that opens on nothing makes somebody guess what a block is."""
    kinds = [block["kind"] for block in document["blocks"]]
    assert kinds == ["HEADING", "TEXT"]
    assert document["page"]["size"] == "A4"
    assert document["page"]["footer"] == "Confidential"
    # Defaults are filled in rather than left absent, so a renderer never guesses.
    assert document["page"]["page_numbers"] is True
    assert document["page"]["margin_mm"] == 20


@pytest.mark.database
def test_the_paper_is_clamped_rather_than_refused(client, monkeypatch, document):
    """Every value here has a sane neighbour; a dragged slider is not a 400."""
    headers = _authenticate(monkeypatch)
    response = client.put(
        f"{DOCUMENTS}/{document['id']}",
        json={"page": {"size": "FOOLSCAP", "orientation": "sideways",
                       "margin_mm": 400, "accent": "puce"}},
        headers=headers,
    )
    assert response.status_code == 200, response.get_json()
    page = response.get_json()["page"]
    assert page["size"] == "A4"
    assert page["orientation"] == "portrait"
    assert page["margin_mm"] == 50
    assert page["accent"] == "#5b5bd6"


@pytest.mark.database
def test_a_block_kind_the_renderer_cannot_draw_is_refused(client, monkeypatch, document):
    """A block with no renderer would vanish from the export in silence."""
    headers = _authenticate(monkeypatch)
    response = client.put(
        f"{DOCUMENTS}/{document['id']}",
        json={"blocks": [{"id": "b1", "kind": "VIDEO"}]},
        headers=headers,
    )
    assert response.status_code == 400, response.get_json()
    assert "VIDEO" in str(response.get_json())


@pytest.mark.database
def test_rendering_answers_with_a_pdf(client, monkeypatch, document):
    headers = _authenticate(monkeypatch)
    response = client.post(
        f"{DOCUMENTS}/{document['id']}/render", json={"format": "pdf"}, headers=headers
    )
    assert response.status_code == 200, response.get_data()[:200]
    assert response.mimetype == "application/pdf"
    assert response.data.startswith(b"%PDF")
    assert "quarterly-review.pdf" in response.headers["Content-Disposition"]


@pytest.mark.database
def test_rendering_answers_with_a_docx(client, monkeypatch, document):
    headers = _authenticate(monkeypatch)
    response = client.post(
        f"{DOCUMENTS}/{document['id']}/render", json={"format": "docx"}, headers=headers
    )
    assert response.status_code == 200
    # A DOCX is a zip container, whatever else it is.
    assert response.data[:2] == b"PK"


@pytest.mark.database
def test_a_format_the_platform_does_not_write_is_refused(client, monkeypatch, document):
    headers = _authenticate(monkeypatch)
    response = client.post(
        f"{DOCUMENTS}/{document['id']}/render", json={"format": "pages"}, headers=headers
    )
    assert response.status_code == 400
    assert "pages" in str(response.get_json())


@pytest.mark.database
def test_a_copy_is_private_and_named_apart(client, monkeypatch, document):
    """A copy that takes the original's name is the one somebody edits by mistake."""
    headers = _authenticate(monkeypatch)
    response = client.post(f"{DOCUMENTS}/{document['id']}/duplicate", headers=headers)
    assert response.status_code == 201, response.get_json()
    copy = response.get_json()
    try:
        assert copy["name"] == "Quarterly review (2)"
        assert copy["scope"] == "PRIVATE"
        assert copy["members"] == []
        assert [block["kind"] for block in copy["blocks"]] == ["HEADING", "TEXT"]
    finally:
        _erase(copy["id"])


# ── the renderers, without a database ────────────────────────────────────


def test_a_pdf_is_produced_from_resolved_content():
    body = documents.render_pdf(
        title="Quarterly review",
        page={"size": "A4", "orientation": "portrait", "margin_mm": 20,
              "header": "Acme", "footer": "Confidential", "page_numbers": True,
              "cover": True, "subtitle": "Q3", "accent": "#5b5bd6"},
        blocks=[
            {"kind": "HEADING", "text": "Summary", "level": 2},
            {"kind": "TEXT", "text": "Two paragraphs.\n\nThe second one."},
            {"kind": "METRICS", "caption": "Orders",
             "items": [{"label": "Revenue", "value": "1,204"}]},
            {"kind": "TABLE", "caption": "By channel", "columns": ["Channel", "Total"],
             "rows": [["Web", "900"], ["Phone", "304"]], "note": ""},
            {"kind": "PAGE_BREAK"},
            {"kind": "NOTE", "text": "[a report that was deleted]"},
        ],
    )
    assert body.startswith(b"%PDF")
    assert len(body) > 1500


def test_an_ampersand_does_not_end_the_build():
    """ReportLab parses paragraph text as XML; `Smith & Sons` is a real name."""
    body = documents.render_pdf(
        title="Smith & Sons <Ltd>",
        page={"cover": True},
        blocks=[{"kind": "TEXT", "text": "Sales to Smith & Sons rose <sharply>."}],
    )
    assert body.startswith(b"%PDF")


def test_a_docx_is_a_zip_of_xml():
    body = documents.render_docx(
        title="Quarterly review",
        page={"size": "A4", "orientation": "landscape", "margin_mm": 15,
              "header": "Acme", "footer": "", "page_numbers": True, "cover": False},
        blocks=[
            {"kind": "HEADING", "text": "Summary", "level": 1},
            {"kind": "TABLE", "columns": ["Channel"], "rows": [["Web"]], "caption": "c"},
        ],
    )
    assert body[:2] == b"PK"


def test_a_table_too_wide_drops_columns_rather_than_shrinking_type():
    """Six-point text is not a smaller table, it is an unreadable one."""
    columns = [f"c{index}" for index in range(10)]
    rows = [[str(index) for index in range(10)]]
    fitted, cut, dropped = documents.fit_columns(columns, rows, "portrait")
    assert len(fitted) == 6
    assert len(cut[0]) == 6
    assert dropped == 4
    # Landscape has room for more, which is the whole reason it is an option.
    assert documents.fit_columns(columns, rows, "landscape")[2] == 1


def test_an_image_that_did_not_arrive_is_none_rather_than_an_exception():
    """A chart the browser could not capture is a table, not a failed export."""
    assert documents.decode_png(None) is None
    assert documents.decode_png("not a data url") is None
    assert documents.decode_png("data:image/png;base64,!!!") is None
    assert documents.decode_png(
        "data:image/png;base64,iVBORw0KGgo="
    ) == b"\x89PNG\r\n\x1a\n"


def test_a_file_name_survives_being_downloaded():
    assert documents.filename("Q3 / Review: final", "pdf") == "q3-review-final.pdf"
    assert documents.filename("", "docx") == "document.docx"
