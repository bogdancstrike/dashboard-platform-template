"""The mailbox (§14–§16).

What is worth asserting is what makes a mailbox trustworthy:

  * it is **one person's** — a thread another account owns is not found, not
    forbidden, because saying "that exists but is not yours" is the disclosure;
  * the folder counts are the *rows'*, recomputed rather than adjusted, so an
    unread badge cannot drift — the single most irritating bug a mail client
    has;
  * a sent message goes to **OUTBOX**, because nothing has transported it and
    a mailbox that claimed `SENT` would be lying about the one thing it is for;
  * a draft is a message in the same table, editable until it goes and never
    afterwards;
  * the bin takes two presses, because a single irreversible delete is the
    gesture people most often regret;
  * and a template fills its placeholders on the server, leaving the ones
    nobody supplied visible rather than blanking them.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
THREADS = f"{PREFIX}/api/mail/threads"
MESSAGES = f"{PREFIX}/api/mail/messages"
TEMPLATES = f"{PREFIX}/api/mail/templates"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"mail-{username}"),
    )
    return {"Authorization": f"Bearer mail-{username}"}


def _compose(client, headers, **overrides):
    payload = {
        "subject": "Mail test — a message",
        "body": "First paragraph.\n\nSecond paragraph.",
        "to": ["someone@example.com"],
    }
    payload.update(overrides)
    response = client.post(MESSAGES, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _inbox_thread(client, headers, *, unread: bool = False, **overrides):
    """A thread of this test's own, in the inbox.

    Composed and then filed, rather than picked out of the seeded mailbox.
    **No test in this file reads the seeded mailbox**, and that is deliberate:
    the first version did, and its own earlier tests archived the threads the
    later ones went looking for — draining the administrator's inbox
    permanently, because the autouse cleanup removes rows a test *created* and
    cannot un-archive rows it *edited*. The same mistake the board spec made
    with its one draggable card.

    `unread=True` goes through the bulk endpoint, which is the only way to make
    a thread unread: a message somebody composed has by definition been read by
    its author.
    """
    thread = _compose(client, headers, **overrides)
    filed = client.put(
        f"{THREADS}/{thread['id']}", json={"folder": "INBOX"}, headers=headers
    )
    assert filed.status_code == 200, filed.get_data(as_text=True)
    if unread:
        client.post(
            f"{THREADS}/bulk",
            json={"ids": [thread["id"]], "action": "UNREAD"},
            headers=headers,
        )
        return client.get(
            f"{THREADS}/{thread['id']}?peek=1", headers=headers
        ).get_json()
    return filed.get_json()


def _folder(answer, name: str) -> dict:
    return next(item for item in answer["folders"] if item["key"] == name)


# ── Access ───────────────────────────────────────────────────────────────


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


# ── The list ─────────────────────────────────────────────────────────────


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


# ── Reading ──────────────────────────────────────────────────────────────


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


# ── Writing ──────────────────────────────────────────────────────────────


def test_a_draft_starts_in_drafts_and_is_not_sent(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers)

    assert thread["folder"] == "DRAFTS"
    assert thread["has_draft"] is True
    assert thread["messages"][0]["is_draft"] is True
    assert thread["messages"][0]["sent_at"] is None


def test_a_sent_message_goes_to_outbox_and_not_to_sent(client, monkeypatch):
    """Nothing has transported it. The folder is the whole claim the row
    makes, and `SENT` would be a lie about the one thing a mailbox is for."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, send=True, subject="Mail test — queued")

    assert thread["folder"] == "OUTBOX"
    assert thread["messages"][0]["is_draft"] is False
    assert thread["messages"][0]["sent_at"] is not None


def test_a_message_with_no_recipient_may_be_drafted_and_not_sent(client, monkeypatch):
    """A draft with nobody in it is what a draft is *for*."""
    headers = _authenticate(monkeypatch)
    draft = _compose(client, headers, to=[], subject="Mail test — no recipient")
    assert draft["folder"] == "DRAFTS"

    response = client.post(
        MESSAGES,
        json={"subject": "Mail test — nowhere", "body": "x", "to": [], "send": True},
        headers=headers,
    )
    assert response.status_code == 400
    assert "recipient" in response.get_json()["message"]


def test_an_address_that_is_not_an_address_is_refused_with_the_reason(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        MESSAGES,
        json={"subject": "Mail test — bad address", "body": "x", "to": ["not-an-address"]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "not-an-address" in response.get_json()["message"]


def test_a_recipient_may_be_a_string_or_an_object_and_is_stored_one_way(
    client, monkeypatch
):
    """Two accepted spellings would be two renderings of a recipient list."""
    headers = _authenticate(monkeypatch)
    thread = _compose(
        client,
        headers,
        subject="Mail test — shapes",
        to=["plain@example.com", {"name": "Named Person", "email": "NAMED@Example.com"}],
    )
    stored = thread["messages"][0]["to"]
    assert stored == [
        {"name": "", "email": "plain@example.com"},
        {"name": "Named Person", "email": "named@example.com"},
    ]


def test_a_reply_joins_the_conversation_rather_than_starting_one(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    existing = _inbox_thread(client, headers, subject="Mail test — conversation")
    before = existing["message_count"]

    answered = client.post(
        MESSAGES,
        json={"thread_id": existing["id"], "body": "Thanks — will do.",
              "to": ["someone@example.com"], "send": True},
        headers=headers,
    ).get_json()

    assert answered["id"] == existing["id"]
    assert answered["message_count"] == before + 1
    # A reply takes the subject of the thread it joins, prefixed once.
    assert answered["messages"][-1]["subject"].startswith("Re: ")


def test_a_draft_is_editable_until_it_goes_and_never_afterwards(client, monkeypatch):
    """A queued message is a record of something that happened."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, subject="Mail test — editable")
    message_id = thread["messages"][0]["id"]

    edited = client.put(
        f"{MESSAGES}/{message_id}",
        json={"subject": "Mail test — edited", "body": "Rewritten."},
        headers=headers,
    )
    assert edited.status_code == 200
    assert edited.get_json()["messages"][0]["body"] == "Rewritten."

    sent = client.put(f"{MESSAGES}/{message_id}", json={"send": True}, headers=headers)
    assert sent.status_code == 200
    assert sent.get_json()["messages"][0]["is_draft"] is False

    refused = client.put(
        f"{MESSAGES}/{message_id}", json={"body": "Too late."}, headers=headers
    )
    assert refused.status_code == 403
    assert "draft" in refused.get_json()["message"]


def test_discarding_a_draft_takes_its_empty_thread_with_it(client, monkeypatch):
    """A thread whose only message was the draft is not a conversation."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, subject="Mail test — discarded")
    message_id = thread["messages"][0]["id"]

    assert client.delete(f"{MESSAGES}/{message_id}", headers=headers).status_code == 200
    assert client.get(f"{THREADS}/{thread['id']}", headers=headers).status_code == 404


def test_the_body_is_stored_as_text_and_escaped_into_html(client, monkeypatch):
    """A mailbox is not a place to inject script into a colleague's browser."""
    headers = _authenticate(monkeypatch)
    thread = _compose(
        client, headers, subject="Mail test — markup",
        body="Hello <script>alert(1)</script>\n\nSecond.",
    )

    from src.models.content import EmailMessage

    with session_scope() as session:
        row = session.get(EmailMessage, thread["messages"][0]["id"])
        assert "<script>" not in row.body_html
        assert "&lt;script&gt;" in row.body_html
        # The text column keeps exactly what was typed.
        assert "<script>" in row.body_text


# ── Filing ───────────────────────────────────────────────────────────────


def test_moving_a_thread_moves_its_messages(client, monkeypatch):
    """A thread in ARCHIVE whose messages still say INBOX is a mailbox whose
    two halves disagree, and every count read from either is then a bug."""
    headers = _authenticate(monkeypatch)
    thread = _inbox_thread(client, headers, subject="Mail test — moved")

    moved = client.put(
        f"{THREADS}/{thread['id']}", json={"folder": "ARCHIVE"}, headers=headers
    ).get_json()
    assert moved["folder"] == "ARCHIVE"

    opened = client.get(f"{THREADS}/{thread['id']}", headers=headers).get_json()
    assert {item["folder"] for item in opened["messages"]} == {"ARCHIVE"}


def test_a_thread_cannot_be_filed_into_sent(client, monkeypatch):
    """`SENT` is the platform's own folder; letting somebody file an inbound
    message there would make it mean nothing."""
    headers = _authenticate(monkeypatch)
    thread = _inbox_thread(client, headers, subject="Mail test — unfilable")

    response = client.put(
        f"{THREADS}/{thread['id']}", json={"folder": "SENT"}, headers=headers
    )
    assert response.status_code == 400
    assert "ARCHIVE" in response.get_json()["details"]["allowed"]


def test_the_bin_takes_two_presses(client, monkeypatch):
    """A single irreversible delete is the gesture people most often regret."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, subject="Mail test — binned")

    first = client.delete(f"{THREADS}/{thread['id']}", headers=headers).get_json()
    assert first["deleted"] is False
    assert first["folder"] == "TRASH"
    # Still there, and still readable.
    assert client.get(f"{THREADS}/{thread['id']}", headers=headers).status_code == 200

    second = client.delete(f"{THREADS}/{thread['id']}", headers=headers).get_json()
    assert second["deleted"] is True
    assert client.get(f"{THREADS}/{thread['id']}", headers=headers).status_code == 404


def test_a_bulk_action_applies_to_what_was_chosen_and_says_how_many(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    ids = [
        _inbox_thread(client, headers, subject=f"Mail test — bulk {index}")["id"]
        for index in range(3)
    ]

    answer = client.post(
        f"{THREADS}/bulk", json={"ids": ids, "action": "STAR"}, headers=headers
    ).get_json()
    assert answer["changed"] == len(ids)

    after = client.get(f"{THREADS}?starred=1", headers=headers).get_json()
    starred = {item["id"] for item in after["items"] if item["is_starred"]}
    assert set(ids) <= starred


def test_a_bulk_action_reaches_only_this_readers_own_threads(client, monkeypatch):
    admin = _authenticate(monkeypatch)
    theirs = [
        _inbox_thread(client, admin, subject=f"Mail test — not yours {index}")["id"]
        for index in range(2)
    ]

    manager = _authenticate(monkeypatch, "manager", "manager")
    answer = client.post(
        f"{THREADS}/bulk", json={"ids": theirs, "action": "STAR"}, headers=manager
    ).get_json()
    # Nothing changed, and the count says so rather than an error naming
    # somebody else's threads.
    assert answer["changed"] == 0


def test_an_unknown_bulk_action_is_named_rather_than_ignored(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    thread = _inbox_thread(client, headers, subject="Mail test — shredded")
    response = client.post(
        f"{THREADS}/bulk", json={"ids": [thread["id"]], "action": "SHRED"}, headers=headers
    )
    assert response.status_code == 400
    assert "READ" in response.get_json()["details"]["allowed"]


def test_bulk_marking_read_moves_the_unread_count(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    ids = [
        _inbox_thread(
            client, headers, subject=f"Mail test — bulk unread {index}", unread=True
        )["id"]
        for index in range(3)
    ]
    before = client.get(f"{THREADS}?unread=1", headers=headers).get_json()
    assert set(ids) <= {item["id"] for item in before["items"]}

    client.post(f"{THREADS}/bulk", json={"ids": ids, "action": "READ"}, headers=headers)

    after = client.get(f"{THREADS}?unread=1", headers=headers).get_json()
    assert not (set(ids) & {item["id"] for item in after["items"]})


def test_labelling_in_bulk_adds_without_replacing(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    thread = _inbox_thread(client, headers, subject="Mail test — labelled")
    before = set(thread["labels"])

    client.post(
        f"{THREADS}/bulk",
        json={"ids": [thread["id"]], "action": "LABEL", "label": "Mail test"},
        headers=headers,
    )
    opened = client.get(f"{THREADS}/{thread['id']}?peek=1", headers=headers).get_json()
    assert before | {"Mail test"} == set(opened["labels"])

    client.post(
        f"{THREADS}/bulk",
        json={"ids": [thread["id"]], "action": "UNLABEL", "label": "Mail test"},
        headers=headers,
    )
    again = client.get(f"{THREADS}/{thread['id']}?peek=1", headers=headers).get_json()
    assert set(again["labels"]) == before


# ── Templates ────────────────────────────────────────────────────────────


def test_the_composer_can_read_templates_without_being_an_administrator(
    client, monkeypatch
):
    """Somebody with a mailbox should be able to *use* a template without
    being able to edit one (§11, §16)."""
    headers = _authenticate(monkeypatch, "operator", "operator")
    answer = client.get(TEMPLATES, headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["total"] > 0


def test_a_template_is_filled_on_the_server_and_says_what_is_missing(
    client, monkeypatch
):
    """So the composer can warn before somebody sends "Dear {{ name }}"."""
    headers = _authenticate(monkeypatch)
    catalogue = client.get(TEMPLATES, headers=headers).get_json()
    template = next(
        (item for item in catalogue["items"] if item["variables"]), catalogue["items"][0]
    )

    filled = client.post(
        TEMPLATES,
        json={"code": template["code"], "variables": {}},
        headers=headers,
    ).get_json()
    assert filled["code"] == template["code"]

    if template["variables"]:
        name = template["variables"][0]
        supplied = client.post(
            TEMPLATES,
            json={"code": template["code"], "variables": {name: "Nucleus"}},
            headers=headers,
        ).get_json()
        assert name not in supplied["unfilled"]


def test_a_template_that_does_not_exist_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(TEMPLATES, json={"code": "no-such-thing"}, headers=headers)
    assert response.status_code == 404


def test_composing_from_a_template_fills_what_was_left_blank(client, monkeypatch):
    """And never overwrites what somebody typed — a template that replaced an
    edited subject is a template nobody picks twice."""
    headers = _authenticate(monkeypatch)
    catalogue = client.get(TEMPLATES, headers=headers).get_json()
    template = catalogue["items"][0]

    thread = _compose(
        client, headers, subject="", body="", template=template["code"],
        to=["someone@example.com"],
    )
    assert thread["messages"][0]["subject"], "the template supplied the subject"

    kept = _compose(
        client, headers, subject="Mail test — mine", body="",
        template=template["code"], to=["someone@example.com"],
    )
    assert kept["messages"][0]["subject"] == "Mail test — mine"


# ── The denormalised summary ─────────────────────────────────────────────


def test_the_threads_summary_is_recomputed_from_its_messages(client, monkeypatch):
    """Recomputed and never adjusted: a decremented counter drifts the first
    time two things happen at once, and a wrong unread badge is the single most
    irritating bug a mail client can have."""
    headers = _authenticate(monkeypatch)
    thread = _compose(client, headers, subject="Mail test — counted", send=True)

    for index in range(2):
        thread = client.post(
            MESSAGES,
            json={"thread_id": thread["id"], "body": f"Reply {index}.",
                  "to": ["someone@example.com"], "send": True},
            headers=headers,
        ).get_json()

    assert thread["message_count"] == 3

    from src.models.content import EmailMessage, EmailThread

    with session_scope() as session:
        row = session.get(EmailThread, thread["id"])
        live = session.scalars(
            select(EmailMessage).where(
                EmailMessage.thread_id == row.id, EmailMessage.deleted_at.is_(None)
            )
        ).all()
        assert row.message_count == len(live)
        assert row.unread_count == sum(1 for item in live if not item.is_read)
        assert row.snippet and row.snippet.startswith("Reply 1")


def test_a_thread_names_the_people_in_it(client, monkeypatch):
    """Which is how a mail client titles a conversation — "Ada, Mara, you"."""
    headers = _authenticate(monkeypatch)
    thread = _compose(
        client, headers, subject="Mail test — people", send=True,
        to=["first@example.com", "second@example.com"],
    )
    emails = {person["email"] for person in thread["participants"]}
    assert {"first@example.com", "second@example.com"} <= emails
    # Initials from `core/naming`, like every other person the platform draws.
    assert all(person["initials"] for person in thread["participants"])


def test_filing_mail_is_audited_but_not_in_the_activity_feed(client, monkeypatch):
    """Where somebody files their own mail is nobody else's business, and a
    feed of it would drown everything that is (§35)."""
    headers = _authenticate(monkeypatch)
    thread = _inbox_thread(client, headers, subject="Mail test — audited")
    client.put(f"{THREADS}/{thread['id']}", json={"folder": "ARCHIVE"}, headers=headers)

    from src.models.platform import ActivityEntry, AuditLog

    with session_scope() as session:
        entry = session.scalars(
            select(AuditLog)
            .where(
                AuditLog.resource_type == "email_thread",
                AuditLog.resource_id == thread["id"],
                AuditLog.action == "mail.move",
            )
            .order_by(AuditLog.occurred_at.desc())
        ).first()
        assert entry is not None
        assert entry.state_after["folder"] == "ARCHIVE"

        feed = session.scalars(
            select(ActivityEntry).where(
                ActivityEntry.resource_type == "email_thread",
                ActivityEntry.resource_id == thread["id"],
            )
        ).all()
        assert feed == []
