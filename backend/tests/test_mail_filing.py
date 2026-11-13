"""The mailbox (§14–§16). — Filing."""

from __future__ import annotations

from tests.mail_support import (  # noqa: F401
    TEMPLATES,
    THREADS,
    _authenticate,
    _compose,
    _inbox_thread,
    pytestmark,
)


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
