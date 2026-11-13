"""The assistant's Data mode with document collections as sources (§41, §44).

The user picks their records and/or collections (or single files); the model
gets a `search_documents` tool over exactly those, as the user may see them,
and the answer cites file and page next to any records. Fake model only.
"""

from __future__ import annotations

import json

import pytest

from src.config import Config
from src.core import llm
from src.services.knowledge import ingest as ingest
from tests.conftest import persona_claims
from tests.test_knowledge import _file, stub_converter

BASE = f"{Config.API_PREFIX}/api/assistant"
KN = f"{Config.API_PREFIX}/api/knowledge"


def _as(monkeypatch, username="admin", role="administrator"):
    monkeypatch.setattr("src.core.auth.tokens.verify_token", lambda _t: persona_claims(username, role, sid=f"src-{username}"))
    return {"Authorization": f"Bearer src-{username}"}


def _events(response):
    out = []
    for block in response.get_data(as_text=True).split("\n\n"):
        if block.strip():
            lines = dict(line.split(": ", 1) for line in block.splitlines())
            out.append((lines["event"], json.loads(lines["data"])))
    return out


@pytest.fixture()
def collection(client, monkeypatch):
    from src.core import background

    llm.set_client(llm.FakeClient())
    ingest.set_converter(stub_converter)
    headers = _as(monkeypatch)
    with background.synchronous():
        made = client.post(f"{KN}/collections", json={"name": "Assistant sources"}, headers=headers).get_json()
        added = client.post(f"{KN}/collections/{made['id']}/documents",
                            json={"file_ids": [_file("travel.pdf", b"%PDF travel"), _file("notes.md", b"# Notes\n\nParking is free.")]},
                            headers=headers).get_json()
    yield made, added["added"]
    ingest.set_converter(None)
    llm.set_client(None)


@pytest.mark.database
def test_documents_as_sources_are_searched_and_cited_by_page(client, monkeypatch, collection):
    made, documents = collection
    headers = _as(monkeypatch)
    convo = client.post(f"{BASE}/conversations", headers=headers, json={
        "mode": "data", "sources": {"records": False, "collections": [made["id"]]}}).get_json()
    assert convo["sources"] == {"records": False, "collections": [made["id"]], "documents": []}

    call = llm.ChatResult(text="", tool_calls=[llm.ToolCall("d1", "search_documents", {"query": "hotel cost per night"})])
    fake = llm.FakeClient(script=[call, lambda messages, tools: "Hotels cost at most 180 EUR a night [D1]."])
    llm.set_client(fake)
    events = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages",
                                 json={"content": "How much may a hotel cost?"}, headers=headers))
    # Only the document tool, and the system prompt names the collection.
    assert [t["function"]["name"] for t in fake.calls[0]["tools"]] == ["search_documents"]
    assert "Assistant sources" in fake.calls[0]["messages"][0]["content"]
    assert "DATA MODE" not in fake.calls[0]["messages"][0]["content"]
    passages = json.loads(fake.calls[1]["messages"][-1]["content"])["passages"]
    assert passages[0]["ref"] == "D1" and "page 1" in passages[0]["where"]
    message = events[-1][1]["message"]
    cites = message["citations"]
    assert len(cites) == 1 and cites[0]["resource_type"] == "document"
    assert cites[0]["label"].startswith("[D1] travel.pdf · p. 1")
    assert cites[0]["path"].startswith(f"/ai/documents?collection={made['id']}&passage=")


@pytest.mark.database
def test_records_and_one_file_together(client, monkeypatch, collection):
    made, documents = collection
    headers = _as(monkeypatch)
    notes = next(d for d in documents if d["file"]["name"] == "notes.md")
    convo = client.post(f"{BASE}/conversations", headers=headers, json={"mode": "data"}).get_json()
    updated = client.patch(f"{BASE}/conversations/{convo['id']}", headers=headers, json={
        "sources": {"records": True, "collections": [made["id"]], "documents": [notes["id"]]}}).get_json()
    assert updated["sources"]["documents"] == [notes["id"]]
    call = llm.ChatResult(text="", tool_calls=[llm.ToolCall("d1", "search_documents", {"query": "hotel parking"})])
    fake = llm.FakeClient(script=[call, "From the notes."])
    llm.set_client(fake)
    events = _events(client.post(f"{BASE}/conversations/{convo['id']}/messages", json={"content": "parking?"}, headers=headers))
    assert {t["function"]["name"] for t in fake.calls[0]["tools"]} >= {"search_records", "search_documents"}
    passages = json.loads(fake.calls[1]["messages"][-1]["content"])["passages"]
    assert passages and all("notes.md" in p["where"] for p in passages)
    # None marked in the answer: every passage read is cited.
    assert events[-1][1]["message"]["citations"][0]["label"].startswith("[D1] notes.md")


@pytest.mark.database
def test_sources_are_checked(client, monkeypatch, collection):
    made, _documents = collection
    headers = _as(monkeypatch)
    bad = client.post(f"{BASE}/conversations", headers=headers, json={"mode": "data", "sources": {"records": False}})
    assert bad.status_code == 400
    assert client.post(f"{BASE}/conversations", headers=headers, json={"mode": "data", "sources": "x"}).status_code == 400
    # Somebody who may not see the (private) collection cannot pick it.
    other = _as(monkeypatch, "analyst", "analyst")
    hidden = client.post(f"{BASE}/conversations", headers=other, json={"mode": "data", "sources": {"collections": [made["id"]]}})
    assert hidden.status_code == 400


def test_the_document_tool_explains_its_refusals():
    from src.services.ai import tools as assistant_tools

    class Nobody:
        user_id = None

    assert [t["function"]["name"] for t in assistant_tools.definitions(None, {"records": False, "collections": ["x"]})] == ["search_documents"]
    output, cites, summary = assistant_tools.run(None, "search_documents", {"query": ""}, principal=Nobody(), sources={})
    assert "error" in json.loads(output) and cites == [] and "refused" in summary
