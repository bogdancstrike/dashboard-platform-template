"""Report documents — a composed page, exported as PDF or DOCX (§28).

Layout and prose only. Every block that shows data *names a question* and the
endpoint that owns that question answers it at render time, under the caller's
own permissions — see `services/report_documents.py` for why that line is
where it is.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import report_documents as service


@requires("reports.view")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every document this reader may open, or one more of their own."""
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "POST":
            return service.create(session, json_body(), principal=me()), 201
        return service.listing(session, principal=me()), 200


@requires("reports.view")
def item(app=None, operation: str = "", request=None, document_id: str = "", **kwargs: Any):
    """One document: read it, change it, or remove it. Only the owner writes."""
    identifier = document_id or str(kwargs.get("document_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        principal = me()
        if method == "PUT":
            return service.update(session, identifier, json_body(), principal=principal), 200
        if method == "DELETE":
            return service.remove(session, identifier, principal=principal), 200
        return service.get(session, identifier, principal=principal), 200


@requires("reports.manage")
def duplicate(app=None, operation: str = "", request=None, document_id: str = "", **kwargs: Any):
    """A private copy, owned by the caller — how a document becomes a template."""
    identifier = document_id or str(kwargs.get("document_id") or "")
    with session_scope() as session:
        return service.duplicate(session, identifier, principal=me()), 201


@requires("reports.manage")
def compose(app=None, operation: str = "", request=None, **_: Any):
    """A whole document about one dataset, composed from its declarations.

    The empty document is the honest starting point and it is still a blank
    page. This produces the report a person would have written — summary,
    headline numbers, a chart per declared grouping, the newest rows — out of
    the same declarations the explorer and the analysis catalogue publish, so
    nothing in it is invented. It is a starting point: every block it makes is
    an ordinary block somebody can edit or remove.
    """
    with session_scope() as session:
        return service.compose(session, json_body(), principal=me()), 201


@requires("reports.view", "records.export")
def render(app=None, operation: str = "", request=None, document_id: str = "", **kwargs: Any):
    """The document as a file.

    A POST rather than a GET, for the same reason the explorer's export is one:
    the body carries the chart images the browser already drew, which do not
    belong in a query string — and a URL that produces a download is a URL
    somebody's link preflight eventually fetches.

    `records.export` as well as `reports.view`, because this *is* an export:
    it takes rows out of the platform in a file, and the role that may read a
    page is not automatically the role that may carry it out of the building.
    """
    identifier = document_id or str(kwargs.get("document_id") or "")
    body = json_body() if (request is not None and request.data) else {}
    with session_scope() as session:
        return service.render(session, identifier, body, principal=me())
