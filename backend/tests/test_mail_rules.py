"""The mailbox's edges: every refusal says why, and drafts stay the only thing you may change.

`test_mail` covers the journeys. These are the rules a client trips over —
bulk actions and their arguments, which folders a thread may be filed into,
what a draft edit may and may not do, recipients and labels — each a 400/403
with a reason rather than a 500 or a silently different mailbox. Like
`test_mail`, nothing here reads the seeded mailbox: every thread is composed
by the test itself.
"""

from __future__ import annotations

import pytest

from src.services import mail as service
from tests.personas import PREFIX, as_each

THREADS = f"{PREFIX}/api/mail/threads"
MESSAGES = f"{PREFIX}/api/mail/messages"

pytestmark = pytest.mark.database


def _compose(client, headers, **overrides):
    payload = {"subject": "Mail rules probe", "body": "Hello.\n\nSecond.", "to": ["someone@example.com"]}
    payload.update(overrides)
    response = client.post(MESSAGES, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def test_a_search_term_is_bounded(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    assert client.get(f"{THREADS}?q={'x' * 201}", headers=admin).status_code == 400
    assert client.get(f"{THREADS}?folder=SPAM_ISH", headers=admin).status_code == 400


def test_a_thread_is_starred_flagged_labelled_and_read_in_one_edit(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    thread = _compose(client, admin)
    edited = client.put(f"{THREADS}/{thread['id']}", json={
        "is_starred": True, "is_important": True, "labels": [" b ", "a", "a", ""], "is_read": False,
    }, headers=admin)
    assert edited.status_code == 200, edited.get_json()
    body = edited.get_json()
    assert body["is_starred"] and body["is_important"] and body["labels"] == ["a", "b"]
    assert body["unread_count"] >= 1
    cleared = client.put(f"{THREADS}/{thread['id']}", json={"labels": [], "is_read": True}, headers=admin)
    assert cleared.get_json()["labels"] in (None, []) and cleared.get_json()["unread_count"] == 0

    for bad in ({"labels": "urgent"}, {"labels": [str(i) for i in range(service.MAX_LABELS + 1)]},
                {"folder": "SENT"}, {"folder": "NOWHERE"}):
        assert client.put(f"{THREADS}/{thread['id']}", json=bad, headers=admin).status_code == 400, bad


def test_bulk_actions_apply_to_the_selection_and_refuse_what_they_cannot_do(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    ids = [_compose(client, admin)["id"], _compose(client, admin)["id"]]

    def bulk(**body):
        return client.post(f"{THREADS}/bulk", json=body, headers=admin)

    for action, extra in (("STAR", {}), ("UNSTAR", {}), ("READ", {}), ("UNREAD", {}),
                          ("MOVE", {"folder": "ARCHIVE"}), ("LABEL", {"label": "q3"}),
                          ("UNLABEL", {"label": "q3"})):
        response = bulk(ids=ids, action=action.lower(), **extra)
        assert response.status_code == 200, (action, response.get_json())
        assert response.get_json() == {"changed": 2, "action": action}
    after = client.get(f"{THREADS}/{ids[0]}?peek=1", headers=admin).get_json()
    assert after["folder"] == "ARCHIVE" and not after.get("labels")

    assert bulk(ids=[], action="STAR").status_code == 400
    assert bulk(ids=ids, action="SHRED").status_code == 400
    assert bulk(ids=ids, action="LABEL").status_code == 400
    assert bulk(ids=ids, action="MOVE", folder="OUTBOX").status_code == 400
    assert bulk(ids=["00000000-0000-0000-0000-000000000000"] * 501, action="STAR").status_code == 400


def test_recipients_are_checked_and_folded_to_one_shape(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    for bad in ({"to": ["not an address"]}, {"to": [42]}, {"cc": ["x@y.z"] * (service.MAX_RECIPIENTS + 1)},
                {"priority": "SCREAMING"}, {"body": "x" * (service.MAX_BODY + 1)},
                {"send": True, "to": []}, {"subject": "", "body": "no subject"}):
        payload = {"subject": "Probe", "body": "x", "to": ["a@b.example"], **bad}
        response = client.post(MESSAGES, json=payload, headers=admin)
        assert response.status_code == 400, (bad, response.get_json())

    made = _compose(client, admin, to=["A@B.example", {"name": "Bee", "email": "a@b.example"}],
                    cc="c@d.example", bcc="", priority="high")
    message = made["messages"][-1]
    assert message["to"] == [{"name": "", "email": "a@b.example"}]
    assert message["cc"] == [{"name": "", "email": "c@d.example"}] and message["priority"] == "HIGH"


def test_a_draft_is_edited_sent_once_and_never_again(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    draft = _compose(client, admin, to=[], send=False)
    message_id = draft["messages"][-1]["id"]

    edited = client.put(f"{MESSAGES}/{message_id}", json={
        "subject": "Edited subject", "body": "New <b>body</b>\nline", "priority": "low", "cc": [],
    }, headers=admin)
    assert edited.status_code == 200, edited.get_json()
    assert edited.get_json()["subject"] == "Edited subject"
    assert edited.get_json()["messages"][-1]["body"] == "New <b>body</b>\nline"
    assert edited.get_json()["messages"][-1]["priority"] == "LOW"

    # No recipient yet: it cannot go.
    assert client.put(f"{MESSAGES}/{message_id}", json={"send": True}, headers=admin).status_code == 400
    sent = client.put(f"{MESSAGES}/{message_id}", json={"to": ["x@y.example"], "send": True}, headers=admin)
    assert sent.status_code == 200 and sent.get_json()["folder"] == "OUTBOX"

    # Sent is history: neither editable nor discardable.
    assert client.put(f"{MESSAGES}/{message_id}", json={"subject": "x"}, headers=admin).status_code == 403
    assert client.delete(f"{MESSAGES}/{message_id}", headers=admin).status_code == 403


def test_discarding_the_last_draft_removes_its_thread(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    draft = _compose(client, admin, to=[], send=False)
    message_id = draft["messages"][-1]["id"]
    assert client.delete(f"{MESSAGES}/{message_id}", headers=admin).get_json()["deleted"] is True
    assert client.get(f"{THREADS}/{draft['id']}", headers=admin).status_code == 404


def test_a_reply_inherits_the_subject_and_sends_the_thread(client, monkeypatch):
    admin = as_each(monkeypatch)("admin")
    thread = _compose(client, admin, send=False)
    client.put(f"{THREADS}/{thread['id']}", json={"folder": "INBOX"}, headers=admin)
    reply = client.post(MESSAGES, json={"thread_id": thread["id"], "body": "Agreed.", "to": ["someone@example.com"],
                                        "send": True}, headers=admin)
    assert reply.status_code == 201, reply.get_json()
    body = reply.get_json()
    assert body["messages"][-1]["subject"].startswith("Re: ") and body["folder"] == "OUTBOX"


def test_somebody_elses_thread_does_not_exist_for_you(client, monkeypatch):
    headers = as_each(monkeypatch)
    thread = _compose(client, headers("admin"))
    manager = headers("manager")
    assert client.get(f"{THREADS}/{thread['id']}", headers=manager).status_code == 404
    assert client.put(f"{MESSAGES}/{thread['messages'][-1]['id']}", json={"subject": "x"},
                      headers=manager).status_code == 404


def test_plain_text_and_html_convert_both_ways():
    html = service._as_html("One <two>\nthree\n\n\n\nFour")
    assert html == "<p>One &lt;two&gt;<br>three</p><p>Four</p>"
    assert service._as_text(html) == "One &lt;two&gt;\nthree\n\nFour"
    assert service._as_text(None) == ""
