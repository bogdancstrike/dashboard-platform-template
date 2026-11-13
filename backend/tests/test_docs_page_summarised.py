"""The wiki and meeting notes (§48–49). — page summarised."""

from __future__ import annotations

import pytest

from tests.docs_support import (  # noqa: F401
    DOCS,
    _page,
    people,
    space,
)
from tests.patching import patch_package


@pytest.mark.database
def test_a_page_is_summarised_through_the_model(client, people, space, monkeypatch):
    from src.core import llm

    fake = llm.FakeClient(script=["The team agreed to ship on Friday.\nActions:\n- Mara: draft notes"])
    patch_package(monkeypatch, llm, "get_client", lambda: fake)
    page = _page(client, people["admin"], space["id"], title="Retro",
                 blocks=[{"kind": "text", "text": "We discussed the release and agreed to ship on Friday."}])
    summary = client.post(f"{DOCS}/pages/{page['id']}/summary", headers=people["admin"])
    assert summary.status_code == 200, summary.get_json()
    assert summary.get_json()["summary"].startswith("The team agreed")
    assert "ship on Friday" in fake.calls[0]["messages"][1]["content"]

    empty = _page(client, people["admin"], space["id"], title="E", blocks=[])
    assert client.post(f"{DOCS}/pages/{empty['id']}/summary", headers=people["admin"]).status_code == 400

    class Broken:
        model = "broken"

        def chat(self, *args, **kwargs):
            raise llm.LlmError("LLM_TIMEOUT", "slow")

    patch_package(monkeypatch, llm, "get_client", lambda: Broken())
    failed = client.post(f"{DOCS}/pages/{page['id']}/summary", headers=people["admin"])
    assert failed.status_code == 503


@pytest.mark.database
def test_the_meetings_space_cannot_be_removed(client, people):
    from src.core.db import session_scope
    from src.services.collaboration import docs

    with session_scope() as session:
        space_id = str(docs.meetings_space(session).id)
    assert client.delete(f"{DOCS}/spaces/{space_id}", headers=people["admin"]).status_code == 409
