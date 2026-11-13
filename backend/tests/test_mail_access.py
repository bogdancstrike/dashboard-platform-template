"""The mailbox (§14–§16). — Access."""

from __future__ import annotations

from tests.mail_support import (  # noqa: F401
    MESSAGES,
    THREADS,
    _authenticate,
    _compose,
    _folder,
    _inbox_thread,
    pytestmark,
)


def test_the_mail_endpoints_need_a_bearer_token(client):
    assert client.get(THREADS).status_code == 401
    assert client.post(MESSAGES, json={}).status_code == 401


def test_a_mailbox_is_one_persons(client, monkeypatch):
    """Two accounts, two mailboxes, and neither can see the other's."""
    admin = _authenticate(monkeypatch)
    _inbox_thread(client, admin, subject="Mail test — the admin's own")
    mine = client.get(THREADS, headers=admin).get_json()

    manager = _authenticate(monkeypatch, "manager", "manager")
    _inbox_thread(client, manager, subject="Mail test — the manager's own")
    theirs = client.get(THREADS, headers=manager).get_json()

    my_ids = {item["id"] for item in mine["items"]}
    their_ids = {item["id"] for item in theirs["items"]}
    assert my_ids and their_ids
    assert not (my_ids & their_ids)


def test_somebody_elses_thread_is_not_found_rather_than_forbidden(client, monkeypatch):
    """Saying "that exists but is not yours" is itself the disclosure."""
    admin = _authenticate(monkeypatch)
    theirs = _inbox_thread(client, admin, subject="Mail test — private")["id"]

    manager = _authenticate(monkeypatch, "manager", "manager")
    response = client.get(f"{THREADS}/{theirs}", headers=manager)
    assert response.status_code == 404


def test_an_analyst_has_no_mailbox_at_all(client, monkeypatch):
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    assert client.get(THREADS, headers=headers).status_code == 403


def test_every_folder_is_listed_even_when_it_is_empty(client, monkeypatch):
    """An empty Drafts is information; a sidebar that hides folders until they
    fill teaches nobody where anything goes."""
    headers = _authenticate(monkeypatch)
    answer = client.get(THREADS, headers=headers).get_json()

    from src.core.vocabulary import EMAIL_FOLDER

    assert [item["key"] for item in answer["folders"]] == list(EMAIL_FOLDER)


def test_the_folder_counts_are_the_rows_and_not_the_page(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    _inbox_thread(client, headers, subject="Mail test — counted rows")
    answer = client.get(f"{THREADS}?page_size=1", headers=headers).get_json()

    assert len(answer["items"]) == 1
    # Computed over the mailbox, not over what was returned (§44, §71).
    assert _folder(answer, "INBOX")["total"] == answer["total"]


def test_an_unknown_folder_is_named_rather_than_ignored(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.get(f"{THREADS}?folder=SHOEBOX", headers=headers)
    assert response.status_code == 400
    assert "INBOX" in response.get_json()["details"]["allowed"]


def test_the_search_narrows_by_subject(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    # Two of its own, so "narrowed" is a claim about this test's data rather
    # than about whatever the seeded mailbox happens to hold.
    _inbox_thread(client, headers, subject="Mail test — findable zarquon")
    _inbox_thread(client, headers, subject="Mail test — something else")
    everything = client.get(THREADS, headers=headers).get_json()

    narrowed = client.get(f"{THREADS}?q=zarquon", headers=headers).get_json()
    assert narrowed["total"] == 1
    assert narrowed["total"] < everything["total"]
    assert narrowed["items"][0]["subject"] == "Mail test — findable zarquon"


def test_the_labels_offered_are_the_ones_in_use(client, monkeypatch):
    """A filter offering twelve names when three are used mostly returns
    nothing."""
    headers = _authenticate(monkeypatch)
    thread = _inbox_thread(client, headers, subject="Mail test — label counts")
    client.put(
        f"{THREADS}/{thread['id']}", json={"labels": ["Mail test label"]}, headers=headers
    )
    answer = client.get(THREADS, headers=headers).get_json()
    assert "Mail test label" in [item["key"] for item in answer["labels"]]

    for label in answer["labels"]:
        narrowed = client.get(f"{THREADS}?label={label['key']}", headers=headers).get_json()
        # Both sides are scoped to the same folder, so a count that is offered
        # is a count the click can find.
        assert narrowed["total"] == label["count"], (
            f"{label['key']} is offered as {label['count']} and finds {narrowed['total']}"
        )


def test_opening_a_thread_marks_it_read_and_the_count_follows(client, monkeypatch):
    """Honest rather than clever: those messages *were* on screen."""
    headers = _authenticate(monkeypatch)
    unread = _inbox_thread(client, headers, subject="Mail test — unread", unread=True)
    assert unread["unread_count"] > 0
    listing = client.get(THREADS, headers=headers).get_json()

    opened = client.get(f"{THREADS}/{unread['id']}", headers=headers).get_json()
    assert opened["unread_count"] == 0
    assert all(message["is_read"] for message in opened["messages"])

    # And the folder count moved with it, because it is a fact about rows.
    after = client.get(THREADS, headers=headers).get_json()
    assert _folder(after, unread["folder"])["unread"] < _folder(
        listing, unread["folder"]
    )["unread"]


def test_a_thread_can_be_looked_at_without_marking_it_read(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    unread = _inbox_thread(client, headers, subject="Mail test — peeked", unread=True)

    peeked = client.get(f"{THREADS}/{unread['id']}?peek=1", headers=headers).get_json()
    assert peeked["unread_count"] == unread["unread_count"]


def test_a_thread_carries_its_messages_oldest_first(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, subject="Mail test — ordered", send=True)
    for index in range(2):
        thread = client.post(
            MESSAGES,
            json={"thread_id": thread["id"], "body": f"Reply {index}.",
                  "to": ["someone@example.com"], "send": True},
            headers=headers,
        ).get_json()

    opened = client.get(f"{THREADS}/{thread['id']}", headers=headers).get_json()
    stamps = [item["sent_at"] for item in opened["messages"] if item["sent_at"]]
    assert len(stamps) == 3
    assert stamps == sorted(stamps), "a conversation reads in the order it happened"
