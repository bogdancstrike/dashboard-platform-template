"""Ask your documents (§44), end to end against PostgreSQL and object storage.

No network beyond the compose services: the converter is a stub that answers
the way the Docling service does, and the model is the deterministic fake
(`core/llm.FakeClient`), so no test spends a token or waits on a model.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.config import Config
from src.core import background, llm
from src.services import knowledge_ingest as ingest
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
API = f"{PREFIX}/api/knowledge"


def _as(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims(username, role, sid=f"kn-{username}"),
    )
    return {"Authorization": f"Bearer kn-{username}"}


def stub_converter(data: bytes, filename: str) -> dict:
    """What Docling answers for a two-page policy document."""
    if b"BROKEN" in data:
        return {"ok": False, "code": "FILE_PARSE_ERROR", "detail": "could not convert"}
    return {
        "ok": True, "device": "cpu", "pages": 2, "warnings": ["DOCLING_CPU"],
        "outline": [{"title": "Travel policy", "page": 1}, {"title": "Hotels", "page": 1},
                    {"title": "Expense claims", "page": 2}],
        "sections": [
            {"kind": "text", "text": "Travel policy", "heading_path": ["Travel policy"], "page_from": 1, "page_to": 1,
             "boxes": [{"page": 1, "x": 0.4, "y": 0.1, "w": 0.2, "h": 0.02}]},
            {"kind": "text", "text": "Hotels may cost at most 180 EUR per night in any city.",
             "heading_path": ["Travel policy", "Hotels"], "page_from": 1, "page_to": 1,
             "boxes": [{"page": 1, "x": 0.13, "y": 0.2, "w": 0.7, "h": 0.01}]},
            {"kind": "table", "text": "| Grade | Limit |\n|---|---|\n| A | 180 |\n| B | 150 |",
             "heading_path": ["Travel policy", "Hotels"], "page_from": 1, "page_to": 1, "boxes": []},
            {"kind": "text", "text": "Expense claims must be filed within 30 days of the trip, with receipts.",
             "heading_path": ["Expense claims"], "page_from": 2, "page_to": 2,
             "boxes": [{"page": 2, "x": 0.13, "y": 0.13, "w": 0.5, "h": 0.01}]},
        ],
    }


@pytest.fixture()
def fake_ai():
    llm.set_client(llm.FakeClient())
    ingest.set_converter(stub_converter)
    with background.synchronous():
        yield
    llm.set_client(None)
    ingest.set_converter(None)


def _file(name: str, body: bytes):
    """A READY file in the file manager with its bytes in storage."""
    from src.core import storage
    from src.core.db import session_scope
    from src.models.content import FileObject

    key = storage.key_for("files", "tests", f"{uuid4().hex}-{name}")
    storage.for_config().put(key, body, content_type="application/octet-stream")
    with session_scope() as session:
        row = FileObject(name=name, extension=storage.extension_of(name), kind="DOCUMENT",
                         size_bytes=len(body), storage_key=key, status="READY", visibility="PRIVATE")
        session.add(row)
        session.flush()
        return str(row.id)


def _collection(client, headers, **extra) -> dict:
    response = client.post(f"{API}/collections", json={"name": f"Policies {uuid4().hex[:6]}", **extra},
                           headers=headers)
    assert response.status_code == 201, response.get_json()
    return response.get_json()


@pytest.mark.database
def test_a_collection_reads_its_files_and_answers_with_citations(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    collection = _collection(client, headers, description="Company rules")
    assert collection["folder_id"] and collection["can_edit"] and collection["documents"] == []

    pdf = _file("travel.pdf", b"%PDF-1.4 travel")
    notes = _file("notes.md", b"# Notes\n\nThe office opens at 8am.\n\n## Parking\n\nParking is free for visitors.")
    added = client.post(f"{API}/collections/{collection['id']}/documents",
                        json={"file_ids": [pdf, notes]}, headers=headers)
    assert added.status_code == 201, added.get_json()
    assert len(added.get_json()["added"]) == 2

    detail = client.get(f"{API}/collections/{collection['id']}", headers=headers).get_json()
    by_name = {d["file"]["name"]: d for d in detail["documents"]}
    assert by_name["travel.pdf"]["status"] == "READY"
    assert by_name["travel.pdf"]["pages"] == 2 and by_name["travel.pdf"]["parser"] == "docling"
    assert by_name["travel.pdf"]["chunk_count"] >= 3
    assert by_name["travel.pdf"]["embedded_count"] == by_name["travel.pdf"]["chunk_count"]
    assert by_name["notes.md"]["parser"] == "text" and by_name["notes.md"]["status"] == "READY"
    assert detail["counts"]["ready"] == 2

    # Adding the same file again is skipped, not duplicated.
    again = client.post(f"{API}/collections/{collection['id']}/documents",
                        json={"file_ids": [pdf]}, headers=headers).get_json()
    assert again["added"] == [] and again["skipped"] == [pdf]

    asked = client.post(f"{API}/ask", json={"collection_id": collection["id"],
                                            "question": "How much may a hotel cost per night?"},
                        headers=headers)
    assert asked.status_code == 200, asked.get_json()
    answer = asked.get_json()
    assert answer["status"] == "ANSWERED"
    assert answer["citations"], answer
    first = answer["citations"][0]
    assert first["n"] == 1 and "[1]" in answer["answer"]
    assert first["file_name"] in ("travel.pdf", "notes.md")
    cited_hotel = [c for c in answer["citations"] if "180 EUR" in c["quote"]]
    assert cited_hotel and cited_hotel[0]["page"] == 1 and cited_hotel[0]["boxes"]

    # The passage endpoint gives the preview what it needs to mark it.
    passage = client.get(f"{API}/collections/{collection['id']}/passages/{first['chunk_id']}",
                         headers=headers).get_json()
    assert passage["file_id"] == first["file_id"]

    # A follow-up in the same thread is part of the same conversation.
    follow = client.post(f"{API}/ask", json={"collection_id": collection["id"], "thread_id": answer["thread_id"],
                                             "question": "And when must expense claims be filed?"},
                         headers=headers).get_json()
    assert follow["thread_id"] == answer["thread_id"]
    history = client.get(f"{API}/collections/{collection['id']}/history", headers=headers).get_json()
    assert [t["turns"] for t in history["threads"]] == [2]
    assert history["threads"][0]["title"].startswith("How much")
    assert len(client.get(f"{API}/collections/{collection['id']}/history?thread_id={answer['thread_id']}",
                          headers=headers).get_json()["items"]) == 2

    suggestions = client.get(f"{API}/collections/{collection['id']}/suggestions", headers=headers).get_json()
    assert any("hotels" in s.lower() for s in suggestions["items"])

    overview = client.get(f"{API}/overview", headers=headers).get_json()
    assert overview["collections"] >= 1 and overview["questions"] >= 2

    forgot = client.delete(f"{API}/collections/{collection['id']}/threads/{answer['thread_id']}",
                           headers=headers).get_json()
    assert forgot["removed"] == 2


@pytest.mark.database
def test_nothing_relevant_is_said_plainly(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    collection = _collection(client, headers)
    asked = client.post(f"{API}/ask", json={"collection_id": collection["id"], "question": "Who won the cup?"},
                        headers=headers).get_json()
    assert asked["status"] == "NO_ANSWER" and asked["citations"] == []


@pytest.mark.database
def test_a_real_model_answer_keeps_only_real_citations(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    collection = _collection(client, headers)
    client.post(f"{API}/collections/{collection['id']}/documents",
                json={"file_ids": [_file("travel.pdf", b"%PDF travel")]}, headers=headers)
    # A scripted model: it cites source 2 first, then 1, and invents a 9.
    llm.set_client(llm.FakeClient(script=["Claims take 30 days [2]. Hotels cap at 180 EUR [1][9]."]))
    answer = client.post(f"{API}/ask", json={"collection_id": collection["id"],
                                             "question": "hotel night cost and expense claims days"},
                         headers=headers).get_json()
    assert answer["answer"] == "Claims take 30 days [1]. Hotels cap at 180 EUR [2]."
    assert [c["n"] for c in answer["citations"]] == [1, 2]

    # A model that cannot be reached is a 503 with a code, never a 500.
    class Down(llm.FakeClient):
        def chat(self, *args, **kwargs):
            raise llm.LlmError("LLM_TIMEOUT", "slow", retryable=True)

    llm.set_client(Down(script=["unused"]))
    failed = client.post(f"{API}/ask", json={"collection_id": collection["id"], "question": "hotel night"},
                         headers=headers)
    assert failed.status_code == 503


@pytest.mark.database
def test_a_failed_reading_is_recorded_and_can_be_reprocessed(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    collection = _collection(client, headers)
    broken = _file("broken.pdf", b"BROKEN")
    added = client.post(f"{API}/collections/{collection['id']}/documents",
                        json={"file_ids": [broken]}, headers=headers).get_json()
    document_id = added["added"][0]["id"]
    document = client.get(f"{API}/collections/{collection['id']}/documents/{document_id}", headers=headers).get_json()
    assert document["status"] == "FAILED" and document["error_code"] == "FILE_PARSE_ERROR"

    from src.core.db import session_scope
    from src.models.platform import BackgroundJob

    with session_scope() as session:
        job = session.get(BackgroundJob, document["job_id"])
        assert job.kind == "INGEST" and job.status == "FAILED"

    ingest.set_converter(lambda data, name: stub_converter(b"fixed", name))
    redone = client.post(f"{API}/collections/{collection['id']}/documents/{document_id}/reprocess", headers=headers)
    assert redone.status_code == 202
    document = client.get(f"{API}/collections/{collection['id']}/documents/{document_id}", headers=headers).get_json()
    assert document["status"] == "READY"

    removed = client.delete(f"{API}/collections/{collection['id']}/documents/{document_id}", headers=headers)
    assert removed.get_json()["removed"] is True
    assert client.get(f"{API}/collections/{collection['id']}/documents/{document_id}",
                      headers=headers).status_code == 404


@pytest.mark.database
def test_files_that_cannot_be_read_are_refused(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    collection = _collection(client, headers)
    url = f"{API}/collections/{collection['id']}/documents"
    assert client.post(url, json={"file_ids": []}, headers=headers).status_code == 400
    assert client.post(url, json={"file_ids": [_file("tool.zip", b"PK")]}, headers=headers).status_code == 400
    assert client.post(url, json={"file_ids": [str(uuid4())]}, headers=headers).status_code == 404


@pytest.mark.database
def test_only_the_audience_sees_a_collection(client, monkeypatch, fake_ai):
    owner = _as(monkeypatch, "manager", "manager")
    private = _collection(client, owner)
    public = _collection(client, owner, scope="PUBLIC")

    reader = _as(monkeypatch, "analyst", "analyst")
    seen = {c["id"] for c in client.get(f"{API}/collections", headers=reader).get_json()["items"]}
    assert public["id"] in seen and private["id"] not in seen
    assert client.get(f"{API}/collections/{private['id']}", headers=reader).status_code == 404
    assert client.post(f"{API}/ask", json={"collection_id": private["id"], "question": "x"},
                       headers=reader).status_code == 404
    # Seeing is not owning: only the owner changes it.
    assert client.put(f"{API}/collections/{public['id']}", json={"name": "Mine now"},
                      headers=reader).status_code == 403

    owner = _as(monkeypatch, "manager", "manager")
    shared = client.put(f"{API}/collections/{private['id']}", json={"scope": "SHARED", "member_ids": []},
                        headers=owner).get_json()
    assert shared["scope"] == "SHARED"
    renamed = client.put(f"{API}/collections/{private['id']}",
                         json={"name": "Renamed", "description": "d", "color": "#112233"}, headers=owner).get_json()
    assert renamed["name"] == "Renamed" and renamed["color"] == "#112233"
    mine = client.get(f"{API}/collections?scope=mine&q=Renamed", headers=owner).get_json()
    assert [c["id"] for c in mine["items"]] == [private["id"]]
    assert client.delete(f"{API}/collections/{private['id']}", headers=owner).get_json()["deleted"]
    assert client.get(f"{API}/collections/{private['id']}", headers=owner).status_code == 404


@pytest.mark.database
def test_a_viewer_may_ask_but_not_build(client, monkeypatch, fake_ai):
    viewer = _as(monkeypatch, "user", "user")
    assert client.get(f"{API}/collections", headers=viewer).get_json()["can_create"] is False
    assert client.post(f"{API}/collections", json={"name": "x"}, headers=viewer).status_code == 403


@pytest.mark.database
def test_validation(client, monkeypatch, fake_ai):
    headers = _as(monkeypatch)
    assert client.post(f"{API}/collections", json={"name": " "}, headers=headers).status_code == 400
    assert client.post(f"{API}/collections", json={"name": "x" * 200}, headers=headers).status_code == 400
    collection = _collection(client, headers)
    assert client.post(f"{API}/ask", json={"collection_id": collection["id"], "question": ""},
                       headers=headers).status_code == 400
    assert client.post(f"{API}/ask", json={"collection_id": collection["id"], "question": "x" * 3000},
                       headers=headers).status_code == 400


# ── units: no database ───────────────────────────────────────────────────


def test_chunks_never_cross_a_page_and_grow_to_the_target():
    sections = [ingest.Section(text="A" * 600, page_from=1, heading_path=["H"]),
                ingest.Section(text="B" * 600, page_from=1, heading_path=["H"]),
                ingest.Section(text="C" * 600, page_from=1, heading_path=["H"]),
                ingest.Section(text="D", page_from=2, heading_path=["H"]),
                ingest.Section(text="  "),
                ingest.Section(text="x. " * 1200, page_from=3)]
    chunks = ingest.chunk(sections)
    assert [c["page_from"] for c in chunks[:3]] == [1, 1, 2]
    assert len(chunks[0]["text"]) == 1202
    assert all(len(c["text"]) <= ingest.HARD_LIMIT for c in chunks)
    assert [c["ordinal"] for c in chunks] == list(range(len(chunks)))


def test_long_tables_split_on_rows_with_the_header():
    table = "| a | b |\n|---|---|\n" + "\n".join(f"| {i} | {'x' * 60} |" for i in range(80))
    pieces = ingest.chunk([ingest.Section(text=table, kind="table", page_from=1)])
    assert len(pieces) > 1 and all(p["text"].startswith("| a | b |") for p in pieces)


def test_text_files_are_read_here():
    parsed = ingest.parse(b"# Title\nIntro\n\nBody one.\n\n## Sub\n\nBody two.", "a.md")
    assert parsed.parser == "text" and [o["title"] for o in parsed.outline] == ["Title", "Sub"]
    assert ingest.parse(b"a,b\n1,2\n", "a.csv").sections[1].text == "1,2"
    with pytest.raises(ingest.IngestError):
        ingest.parse(b"", "a.zip")


def test_the_converter_failures_have_codes(monkeypatch):
    import requests

    class Response:
        def __init__(self, status, body=None):
            self.status_code, self._body = status, body

        def json(self):
            if self._body is None:
                raise ValueError
            return self._body

    for status, code in ((415, "FILE_UNSUPPORTED"), (413, "FILE_TOO_LARGE"), (500, "FILE_CONVERTER_UNAVAILABLE"),
                         (200, "FILE_PARSE_ERROR")):
        monkeypatch.setattr(requests, "post", lambda *a, _s=status, **k: Response(_s))
        with pytest.raises(ingest.IngestError) as error:
            ingest.docling_convert(b"x", "a.pdf")
        assert error.value.code == code

    def unreachable(*_a, **_k):
        raise requests.ConnectionError("no")

    monkeypatch.setattr(requests, "post", unreachable)
    with pytest.raises(ingest.IngestError):
        ingest.docling_convert(b"x", "a.pdf")
    monkeypatch.setattr(requests, "post", lambda *a, **k: Response(200, {"ok": True, "sections": []}))
    assert ingest.docling_convert(b"x", "a.pdf") == {"ok": True, "sections": []}


def test_embeddings_degrade_instead_of_failing():
    class Down(llm.FakeClient):
        def embed(self, texts):
            raise llm.LlmError("LLM_UNAVAILABLE", "down")

    llm.set_client(Down())
    try:
        assert ingest.embed(["a"]) == (None, "LLM_UNAVAILABLE")
        assert ingest.embed_query("a") is None
        assert ingest.embed([]) == ([], None)
    finally:
        llm.set_client(None)


def test_citations_are_renumbered_by_first_appearance():
    from src.services import knowledge

    sources = [{"n": n, "chunk_id": str(n), "document_id": "d", "file_id": "f", "file_name": "a.pdf",
                "extension": "pdf", "page": n, "heading": "", "text": f"text {n}", "boxes": [], "score": 0.1}
               for n in (1, 2, 3)]
    text, citations = knowledge.cite("B [3] and A [1][3] and nothing [7].", sources)
    assert text == "B [1] and A [2][1] and nothing ."
    assert [(c["n"], c["page"]) for c in citations] == [(1, 3), (2, 1)]


def test_the_vector_type_round_trips():
    from src.models.vector import Vector, from_text, to_text

    assert to_text([1, 2.5]) == "[1.0,2.5]" and to_text(None) is None and to_text("[1]") == "[1]"
    assert from_text("[1,2.5]") == [1.0, 2.5] and from_text(None) is None
    assert from_text([1, 2]) == [1.0, 2.0] and from_text("[]") == []
    column = Vector()
    assert column.get_col_spec() == "vector"
    assert column.bind_processor(None)([1]) == "[1.0]"
    assert column.result_processor(None, None)("[3]") == [3.0]


@pytest.mark.database
def test_a_document_over_the_converter_limit_is_refused(client, monkeypatch, fake_ai):
    from src.core.db import session_scope
    from src.models.content import FileObject

    headers = _as(monkeypatch)
    collection = _collection(client, headers)
    big = _file("huge.pdf", b"%PDF")
    with session_scope() as session:
        session.get(FileObject, big).size_bytes = 60 * 1024 * 1024
    refused = client.post(f"{API}/collections/{collection['id']}/documents", json={"file_ids": [big]}, headers=headers)
    assert refused.status_code == 400 and "50 MB" in refused.get_json()["message"]
    assert client.get(f"{API}/collections", headers=headers).get_json()["max_document_bytes"] == 50 * 1024 * 1024


def test_job_references_need_no_sequence():
    """Concurrent adds raced on MAX(reference); the reference is now derived."""
    from types import SimpleNamespace
    from uuid import uuid4

    document = SimpleNamespace(id=uuid4())
    first, second = ingest._reference(document), ingest._reference(document)
    assert first.startswith(f"ING-{document.id.hex[:12].upper()}-") and first != second
    assert len(first) <= 32
