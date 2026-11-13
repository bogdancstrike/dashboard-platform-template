"""The wiki and meeting notes (§48–49).

What is asserted is the shape of a body of knowledge: pages nest and move
without loops, every save is history that can be restored, a record mentioned
in a page lists the page, search finds words in the body, and the action items
in meeting notes become real tasks exactly once.
"""

from __future__ import annotations

from datetime import timedelta
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
DOCS = f"{PREFIX}/api/docs"
ROLES = {"admin": "administrator", "manager": "manager", "user": "user", "analyst": "analyst"}


@pytest.fixture()
def people(monkeypatch):
    def verify(token: str):
        username = token.removeprefix("docs-")
        return persona_claims(username, ROLES[username], sid=f"docs-{username}")

    monkeypatch.setattr("src.core.auth.tokens.verify_token", verify)
    return {name: {"Authorization": f"Bearer docs-{name}"} for name in ROLES}


@pytest.fixture()
def space(client, people):
    created = client.post(f"{DOCS}/spaces", json={"name": f"Test space {uuid4().hex[:6]}"},
                          headers=people["admin"])
    assert created.status_code == 201, created.get_json()
    return created.get_json()


def _page(client, headers, space_id, **extra):
    response = client.post(f"{DOCS}/pages", json={"space_id": space_id, **extra}, headers=headers)
    assert response.status_code == 201, response.get_json()
    return response.get_json()


def _user_id(username: str) -> UUID:
    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        return session.scalars(select(User.id).where(User.username == username)).one()


def test_the_wiki_needs_a_bearer_token(client):
    assert client.get(f"{DOCS}/spaces").status_code == 401
    assert client.get(f"{DOCS}/search?q=x").status_code == 401


@pytest.mark.database
def test_spaces_are_listed_counted_renamed_and_removed(client, people, space):
    duplicate = client.post(f"{DOCS}/spaces", json={"name": space["name"]}, headers=people["admin"])
    assert duplicate.status_code == 409
    assert client.post(f"{DOCS}/spaces", json={"name": "  "}, headers=people["admin"]).status_code == 400

    _page(client, people["admin"], space["id"], title="One")
    listing = client.get(f"{DOCS}/spaces", headers=people["user"]).get_json()
    row = next(item for item in listing["items"] if item["id"] == space["id"])
    assert row["page_count"] == 1
    assert listing["can_edit"] is False
    assert client.get(f"{DOCS}/spaces", headers=people["admin"]).get_json()["can_edit"] is True

    renamed = client.put(f"{DOCS}/spaces/{space['id']}",
                         json={"name": "Renamed", "description": "About", "icon": "🧪"},
                         headers=people["admin"]).get_json()
    assert (renamed["name"], renamed["description"], renamed["icon"]) == ("Renamed", "About", "🧪")
    assert client.put(f"{DOCS}/spaces/{space['id']}", json={"name": ""},
                      headers=people["admin"]).status_code == 400

    # A viewer reads but does not write.
    assert client.post(f"{DOCS}/spaces", json={"name": "Nope"}, headers=people["user"]).status_code == 403
    assert client.delete(f"{DOCS}/spaces/{space['id']}", headers=people["manager"]).status_code == 403
    assert client.delete(f"{DOCS}/spaces/{space['id']}", headers=people["admin"]).get_json()["deleted"] is True
    assert client.get(f"{DOCS}/spaces/{space['id']}", headers=people["admin"]).status_code == 404


@pytest.mark.database
def test_a_page_starts_from_a_template_and_nests_in_a_tree(client, people, space):
    templates = client.get(f"{DOCS}/templates", headers=people["user"]).get_json()["items"]
    assert {item["key"] for item in templates} == {"blank", "meeting", "runbook", "spec", "retro"}
    assert all(item["blocks"] for item in templates)

    runbook = _page(client, people["admin"], space["id"], template="runbook")
    assert runbook["title"] == "Runbook"
    assert runbook["template"] == "runbook"
    assert any(block["kind"] == "code" for block in runbook["blocks"])
    assert runbook["version"] == 1 and runbook["can_edit"] is True

    child = _page(client, people["admin"], space["id"], title="Child", parent_id=runbook["id"])
    grandchild = _page(client, people["admin"], space["id"], title="Grandchild", parent_id=child["id"])
    assert [crumb["title"] for crumb in grandchild["breadcrumbs"]] == ["Runbook", "Child"]

    tree = client.get(f"{DOCS}/spaces/{space['id']}", headers=people["user"]).get_json()
    assert {item["title"]: item["parent_id"] for item in tree["items"]} == {
        "Runbook": None, "Child": runbook["id"], "Grandchild": child["id"]}

    other = client.post(f"{DOCS}/spaces", json={"name": f"Other {uuid4().hex[:6]}"},
                        headers=people["admin"]).get_json()
    across = client.post(f"{DOCS}/pages", json={"space_id": other["id"], "title": "x",
                                                "parent_id": runbook["id"]}, headers=people["admin"])
    assert across.status_code == 400
    assert client.post(f"{DOCS}/pages", json={"space_id": space["id"], "template": "nope"},
                       headers=people["admin"]).status_code == 400
    assert client.post(f"{DOCS}/pages", json={"space_id": space["id"], "title": "x"},
                       headers=people["user"]).status_code == 403

    # Removing a page removes its branch.
    removed = client.delete(f"{DOCS}/pages/{runbook['id']}", headers=people["admin"]).get_json()
    assert removed["deleted"] == 3
    assert client.get(f"{DOCS}/pages/{grandchild['id']}", headers=people["admin"]).status_code == 404


@pytest.mark.database
@pytest.mark.parametrize("blocks, status", [
    ("not a list", 400),
    (["not an object"], 400),
    ([{"kind": "marquee"}], 400),
    ([{"kind": "list", "items": "x"}], 400),
    ([{"kind": "checklist", "items": "x"}], 400),
    ([{"kind": "table", "rows": ["x"]}], 400),
    ([{"kind": "text", "text": "x" * 20_001}], 400),
    ([{"kind": "text"}] * 401, 400),
    ([{"kind": "record", "resource_type": "task", "resource_id": "nope"}], 400),
])
def test_blocks_that_make_no_sense_are_refused(client, people, space, blocks, status):
    response = client.post(f"{DOCS}/pages", json={"space_id": space["id"], "title": "x", "blocks": blocks},
                           headers=people["admin"])
    assert response.status_code == status


@pytest.mark.database
def test_every_kind_of_block_is_kept_and_cleaned(client, people, space):
    file_id = str(uuid4())
    blocks = [
        {"id": "a", "kind": "heading", "text": "Title", "level": 7},
        {"id": "a", "kind": "text", "text": "Para **bold**"},
        {"kind": "list", "items": ["one", "two"], "ordered": True},
        {"kind": "checklist", "items": [{"text": "do", "done": True}, "junk"]},
        {"kind": "quote", "text": "q"},
        {"kind": "code", "text": "ls", "language": "bash"},
        {"kind": "callout", "text": "c", "tone": "neon"},
        {"kind": "image", "file_id": file_id, "caption": "pic"},
        {"kind": "table", "rows": [["h1", "h2"], ["a", "b"]], "header": False},
        {"kind": "divider"},
        {"kind": "chart", "entity": "ticket", "dimension": "status", "chart": "bar",
         "aggregation": "count", "filters": {"priority": "HIGH"}},
        {"kind": "report", "report_id": str(uuid4()), "show": "both"},
        {"kind": "action", "text": "Call the vendor", "assignee_id": str(_user_id("manager")),
         "due_date": "2026-12-01T00:00:00Z"},
    ]
    created = _page(client, people["admin"], space["id"], title="Kitchen sink", blocks=blocks)
    kept = created["blocks"]
    assert len({block["id"] for block in kept}) == len(kept), "duplicate ids are replaced"
    assert kept[0]["level"] == 2
    assert kept[3]["items"] == [{"text": "do", "done": True}]
    assert kept[6]["tone"] == "info"
    assert kept[7] == {"id": kept[7]["id"], "kind": "image", "file_id": file_id, "caption": "pic"}
    assert kept[8]["header"] is False
    assert kept[10]["filters"] == {"priority": "HIGH"}
    assert kept[12]["due_date"] == "2026-12-01" and kept[12]["task_id"] is None

    from src.services.docs import plain_text

    text = plain_text("T", kept)
    assert "Para bold" in text and "h1 h2" in text and "do" in text


@pytest.mark.database
def test_saving_keeps_history_and_an_old_version_can_be_restored(client, people, space, monkeypatch):
    page = _page(client, people["admin"], space["id"], title="Policy",
                 blocks=[{"kind": "text", "text": "First draft"}])
    url = f"{DOCS}/pages/{page['id']}"

    # A burst of saves by the same person is one revision.
    first = client.put(url, json={"blocks": [{"kind": "text", "text": "Second draft"}],
                                  "expected_version": 1}, headers=people["admin"]).get_json()
    assert first["version"] == 1
    # Somebody else saving is a new version.
    second = client.put(url, json={"title": "Policy v2", "icon": "📜",
                                   "blocks": [{"kind": "text", "text": "Manager's edit"}]},
                        headers=people["manager"]).get_json()
    assert second["version"] == 2
    assert second["updated_by"]["name"] == "Mara Manager"

    stale = client.put(url, json={"title": "Late", "expected_version": 1}, headers=people["admin"])
    assert stale.status_code == 409

    history = client.get(f"{url}/revisions", headers=people["user"]).get_json()
    assert [item["version"] for item in history["items"]] == [2, 1]
    assert history["items"][0]["is_current"] is True
    oldest = history["items"][-1]
    old = client.get(f"{url}/revisions/{oldest['id']}", headers=people["user"]).get_json()
    assert old["blocks"][0]["text"] == "Second draft"
    assert client.get(f"{url}/revisions/{uuid4()}", headers=people["user"]).status_code == 404

    restored = client.post(f"{url}/revisions/{oldest['id']}/restore", headers=people["admin"]).get_json()
    assert restored["version"] == 3
    assert restored["blocks"][0]["text"] == "Second draft"
    assert restored["title"] == "Policy"
    history = client.get(f"{url}/revisions", headers=people["user"]).get_json()
    assert history["items"][0]["note"] == "Restored version 1"
    assert client.post(f"{url}/revisions/{oldest['id']}/restore", headers=people["user"]).status_code == 403
    assert client.put(url, json={"title": " "}, headers=people["admin"]).status_code == 400


@pytest.mark.database
def test_moving_a_page_reorders_siblings_and_refuses_a_loop(client, people, space):
    a = _page(client, people["admin"], space["id"], title="A")
    b = _page(client, people["admin"], space["id"], title="B")
    c = _page(client, people["admin"], space["id"], title="C")
    child = _page(client, people["admin"], space["id"], title="A child", parent_id=a["id"])

    def order():
        items = client.get(f"{DOCS}/spaces/{space['id']}", headers=people["admin"]).get_json()["items"]
        return [item["title"] for item in items if item["parent_id"] is None]

    client.post(f"{DOCS}/pages/{c['id']}/move", json={"before_id": a["id"]}, headers=people["admin"])
    assert order() == ["C", "A", "B"]
    client.post(f"{DOCS}/pages/{c['id']}/move", json={"after_id": a["id"]}, headers=people["admin"])
    assert order() == ["A", "C", "B"]
    client.post(f"{DOCS}/pages/{a['id']}/move", json={"after_id": b["id"]}, headers=people["admin"])
    assert order() == ["C", "B", "A"]
    client.post(f"{DOCS}/pages/{a['id']}/move", json={"before_id": c["id"]}, headers=people["admin"])
    assert order() == ["A", "C", "B"]
    client.post(f"{DOCS}/pages/{b['id']}/move", json={}, headers=people["admin"])
    assert order()[-1] == "B"

    nested = client.post(f"{DOCS}/pages/{b['id']}/move", json={"parent_id": a["id"]},
                         headers=people["admin"]).get_json()
    assert nested["parent_id"] == a["id"]
    loop = client.post(f"{DOCS}/pages/{a['id']}/move", json={"parent_id": child["id"]}, headers=people["admin"])
    assert loop.status_code == 400
    itself = client.post(f"{DOCS}/pages/{a['id']}/move", json={"parent_id": a["id"]}, headers=people["admin"])
    assert itself.status_code == 400
    stranger = client.post(f"{DOCS}/pages/{c['id']}/move", json={"before_id": child["id"]},
                           headers=people["admin"])
    assert stranger.status_code == 400

    other = client.post(f"{DOCS}/spaces", json={"name": f"Elsewhere {uuid4().hex[:6]}"},
                        headers=people["admin"]).get_json()
    moved = client.post(f"{DOCS}/pages/{a['id']}/move", json={"space_id": other["id"]},
                        headers=people["admin"]).get_json()
    assert moved["space_id"] == other["id"]
    tree = client.get(f"{DOCS}/spaces/{other['id']}", headers=people["admin"]).get_json()
    assert {item["title"] for item in tree["items"]} == {"A", "A child", "B"}


@pytest.mark.database
def test_a_record_mentioned_in_a_page_lists_the_page(client, people, space):
    task = client.post(f"{PREFIX}/api/records/task", json={"title": "Backlink fixture"},
                       headers=people["admin"]).get_json()
    page = _page(client, people["admin"], space["id"], title="Design notes", blocks=[
        {"kind": "record", "resource_type": "task", "resource_id": task["id"], "label": "whatever"},
        {"kind": "record", "resource_type": "task", "resource_id": str(uuid4()), "label": "gone"},
    ])
    assert [(link["source"], link["resource_id"]) for link in page["links"]] == [("MENTION", task["id"])]
    assert page["links"][0]["label"] == "Backlink fixture", "the record's own label, not the block's"

    backlinks = client.get(f"{DOCS}/backlinks?resource_type=task&resource_id={task['id']}",
                           headers=people["user"]).get_json()
    assert [item["title"] for item in backlinks["items"]] == ["Design notes"]

    # Removing the block removes the link it made; a manual link stays.
    url = f"{DOCS}/pages/{page['id']}"
    client.put(url, json={"blocks": []}, headers=people["admin"])
    assert client.get(url, headers=people["admin"]).get_json()["links"] == []
    linked = client.post(f"{url}/links", json={"resource_type": "task", "resource_id": task["id"]},
                         headers=people["admin"]).get_json()["links"]
    assert linked[0]["source"] == "MANUAL"
    # Mentioning it again does not duplicate the link.
    again = client.post(f"{url}/links", json={"resource_type": "task", "resource_id": task["id"]},
                        headers=people["admin"]).get_json()["links"]
    assert len(again) == 1
    client.put(url, json={"blocks": [{"kind": "record", "resource_type": "task", "resource_id": task["id"]}]},
               headers=people["admin"])
    assert len(client.get(url, headers=people["admin"]).get_json()["links"]) == 1

    missing = client.post(f"{url}/links", json={"resource_type": "task", "resource_id": str(uuid4())},
                          headers=people["admin"])
    assert missing.status_code == 404
    assert client.delete(f"{url}/links/{uuid4()}", headers=people["admin"]).status_code == 404
    removed = client.delete(f"{url}/links/{linked[0]['id']}", headers=people["admin"]).get_json()
    assert removed["links"] == []


@pytest.mark.database
def test_search_finds_titles_first_then_words_in_the_body(client, people, space):
    marker = uuid4().hex[:8]
    _page(client, people["admin"], space["id"], title="Body hit",
          blocks=[{"kind": "text", "text": f"The {marker} rotation happens weekly."}])
    _page(client, people["admin"], space["id"], title=f"{marker} handbook")

    found = client.get(f"{DOCS}/search?q={marker}", headers=people["user"]).get_json()
    assert [item["title"] for item in found["items"]] == [f"{marker} handbook", "Body hit"]
    assert marker in found["items"][1]["snippet"]
    scoped = client.get(f"{DOCS}/search?q={marker}&space_id={space['id']}", headers=people["user"]).get_json()
    assert scoped["total"] == 2
    assert client.get(f"{DOCS}/search?q=a", headers=people["user"]).get_json()["total"] == 0

    recent = client.get(f"{DOCS}/pages", headers=people["user"]).get_json()["items"]
    assert recent and recent[0]["title"] in (f"{marker} handbook", "Body hit")

    from src.services.docs import _snippet

    assert _snippet("x" * 300, "zzz") == "x" * 160
    assert _snippet("a" * 100 + "needle" + "b" * 200, "needle").startswith("…")


@pytest.mark.database
def test_meeting_notes_are_taken_once_per_event_and_actions_become_tasks(client, people):
    from src.core.clock import now
    from src.core.db import session_scope
    from src.models.business import CalendarEvent, Task

    with session_scope() as session:
        event = CalendarEvent(
            title="Vendor review", description="- Pricing\n- Renewal terms",
            starts_at=now() - timedelta(hours=2), ends_at=now() - timedelta(hours=1), location="Room 4",
            organizer_id=_user_id("admin"),
            participants=[{"user_id": str(_user_id("manager")), "name": "Mara Manager", "response": "ACCEPTED"}],
        )
        session.add(event)
        session.flush()
        event_id = str(event.id)

    opened = client.post(f"{DOCS}/meetings", json={"event_id": event_id}, headers=people["admin"])
    assert opened.status_code == 200, opened.get_json()
    notes = opened.get_json()
    assert notes["created"] is True
    assert notes["space"]["kind"] == "MEETINGS"
    assert notes["event"]["title"] == "Vendor review"
    assert notes["title"].startswith("Vendor review — ")
    lists = [block for block in notes["blocks"] if block["kind"] == "list"]
    assert lists[0]["items"] == ["Mara Manager"]
    assert lists[1]["items"] == ["Pricing", "Renewal terms"]

    again = client.post(f"{DOCS}/meetings", json={"event_id": event_id}, headers=people["manager"]).get_json()
    assert again["id"] == notes["id"] and again["created"] is False
    assert client.post(f"{DOCS}/meetings", json={"event_id": str(uuid4())},
                       headers=people["admin"]).status_code == 404

    url = f"{DOCS}/pages/{notes['id']}"
    action = next(block for block in notes["blocks"] if block["kind"] == "action")
    assert client.post(f"{url}/actions", json={"block_id": action["id"]},
                       headers=people["admin"]).status_code == 400, "an empty action is not a task"
    action.update(text="Send the renewal draft", assignee_id=str(_user_id("manager")), due_date="2026-12-24")
    client.put(url, json={"blocks": notes["blocks"]}, headers=people["admin"])

    made = client.post(f"{url}/actions", json={"block_id": action["id"]}, headers=people["admin"])
    assert made.status_code == 200, made.get_json()
    page = made.get_json()
    task_id = next(block for block in page["blocks"] if block["id"] == action["id"])["task_id"]
    assert page["tasks"][task_id]["title"] == "Send the renewal draft"
    assert page["tasks"][task_id]["assignee"] == "Mara Manager"
    assert page["tasks"][task_id]["status"] == "NEW"
    assert {link["source"] for link in page["links"]} == {"ACTION"}
    assert client.post(f"{url}/actions", json={"block_id": action["id"]},
                       headers=people["admin"]).status_code == 409
    assert client.post(f"{url}/actions", json={"block_id": "nope"}, headers=people["admin"]).status_code == 404

    listed = client.get(f"{DOCS}/meetings?event_id={event_id}", headers=people["user"]).get_json()
    assert listed["items"][0]["actions"] == 1 and listed["items"][0]["tasks"] == 1
    assert listed["can_edit"] is False

    with session_scope() as session:
        task = session.get(Task, UUID(task_id))
        assert task.assignee_id == _user_id("manager")
        assert task.due_date.date().isoformat() == "2026-12-24"


@pytest.mark.database
def test_a_page_is_summarised_through_the_model(client, people, space, monkeypatch):
    from src.core import llm

    fake = llm.FakeClient(script=["The team agreed to ship on Friday.\nActions:\n- Mara: draft notes"])
    monkeypatch.setattr(llm, "get_client", lambda: fake)
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

    monkeypatch.setattr(llm, "get_client", lambda: Broken())
    failed = client.post(f"{DOCS}/pages/{page['id']}/summary", headers=people["admin"])
    assert failed.status_code == 503


@pytest.mark.database
def test_the_meetings_space_cannot_be_removed(client, people):
    from src.core.db import session_scope
    from src.services import docs

    with session_scope() as session:
        space_id = str(docs.meetings_space(session).id)
    assert client.delete(f"{DOCS}/spaces/{space_id}", headers=people["admin"]).status_code == 409
