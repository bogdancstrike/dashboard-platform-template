"""Bookmarks and recents — one store for "what have I starred" (§38, §39). — the deliberate list."""

from __future__ import annotations

import uuid

from sqlalchemy import select

from src.core.db import session_scope
from src.services.records import favorites as service
from tests.favorites_support import (  # noqa: F401
    FAVORITES,
    RECENTS,
    _authenticate,
    _bookmark,
    _mine,
    pytestmark,
)
from tests.patching import patch_package


def test_a_bookmark_can_be_made_and_unmade(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    before = _mine(client, headers)["total"]
    listing = _bookmark(client, headers, label="Made and unmade")

    made = next(item for item in listing["items"] if item["label"] == "Made and unmade")
    assert listing["total"] == before + 1

    after = client.delete(f"{FAVORITES}/{made['id']}", headers=headers)
    assert after.status_code == 200
    assert after.get_json()["total"] == before


def test_starring_the_same_thing_twice_is_not_two_bookmarks(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    resource_id = str(uuid.uuid4())
    first = _bookmark(client, headers, resource_id=resource_id, label="Once")
    second = _bookmark(client, headers, resource_id=resource_id, label="Twice")

    try:
        # Idempotent, because a star is a toggle somebody double-clicks — and
        # the label is refreshed, so a renamed record shows its current name.
        assert second["total"] == first["total"]
        again = [item for item in second["items"] if item["resource_id"] == resource_id]
        assert len(again) == 1
        assert again[0]["label"] == "Twice"
    finally:
        for item in second["items"]:
            if item["resource_id"] == resource_id:
                client.delete(f"{FAVORITES}/{item['id']}", headers=headers)


def test_a_new_bookmark_lands_at_the_end(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    first = _bookmark(client, headers, label="Position one")
    second = _bookmark(client, headers, label="Position two")
    made = [
        item
        for item in second["items"]
        if item["label"] in ("Position one", "Position two")
    ]

    try:
        # Not at the top: the order is somebody's arrangement, and a new
        # bookmark jumping the queue would rearrange it for them.
        assert made[-1]["label"] == "Position two"
        assert made[-1]["position"] > made[0]["position"]
        assert first["total"] < second["total"]
    finally:
        for item in made:
            client.delete(f"{FAVORITES}/{item['id']}", headers=headers)


def test_the_order_is_the_one_somebody_arranged(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    listing = _bookmark(client, headers, label="Arrange A")
    listing = _bookmark(client, headers, label="Arrange B")
    mine = [item for item in listing["items"] if item["label"].startswith("Arrange ")]
    assert len(mine) == 2

    try:
        reversed_ids = [item["id"] for item in reversed(mine)]
        answer = client.put(
            f"{FAVORITES}/order", json={"order": reversed_ids}, headers=headers
        )
        assert answer.status_code == 200
        after = [
            item["label"]
            for item in answer.get_json()["items"]
            if item["label"].startswith("Arrange ")
        ]
        assert after == ["Arrange B", "Arrange A"]
    finally:
        for item in mine:
            client.delete(f"{FAVORITES}/{item['id']}", headers=headers)


def test_arranging_a_stale_list_is_refused_rather_than_half_applied(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.put(
        f"{FAVORITES}/order", json={"order": [str(uuid.uuid4())]}, headers=headers
    )
    # Half an arrangement is worse than none: a page that had not refreshed
    # would otherwise reshuffle what it could and leave the rest.
    assert answer.status_code == 400
    assert answer.get_json()["details"]["ids"]


def test_only_so_many_bookmarks(client, monkeypatch):
    patch_package(monkeypatch, service, "MAX_FAVORITES", 1)
    headers = _authenticate(monkeypatch)

    listing = _mine(client, headers)
    if listing["total"] >= 1:
        # Already at the patched limit, which is the state being tested.
        refused = client.post(
            FAVORITES,
            json={
                "resource_type": "ticket",
                "resource_id": str(uuid.uuid4()),
                "label": "One too many",
                "url": "/tickets/x",
            },
            headers=headers,
        )
        assert refused.status_code == 409
        # A shortcut bar with two hundred things in it is not a shortcut bar,
        # and the refusal names the number so somebody can tidy.
        assert refused.get_json()["details"]["maximum"] == 1


def test_somebody_elses_bookmark_is_not_there(client, monkeypatch):
    from src.models.identity import User
    from src.models.personal import Favorite

    headers = _authenticate(monkeypatch, "analyst", "analyst")
    with session_scope() as session:
        me = session.scalar(select(User).where(User.username == "analyst"))
        theirs = session.scalar(select(Favorite).where(Favorite.user_id != me.id))
    assert theirs is not None, "the seed has no other people's bookmarks"

    listed = _mine(client, headers)
    assert str(theirs.id) not in {item["id"] for item in listed["items"]}
    # 404 rather than 403: the reply must not confirm it exists.
    assert client.delete(f"{FAVORITES}/{theirs.id}", headers=headers).status_code == 404


def test_a_visit_is_recorded_and_counted_rather_than_appended(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    resource_id = str(uuid.uuid4())
    body = {
        "resource_type": "ticket",
        "resource_id": resource_id,
        "label": "Visited twice",
        "url": f"/tickets/{resource_id}",
    }

    first = client.post(RECENTS, json=body, headers=headers)
    assert first.status_code == 200
    client.post(RECENTS, json=body, headers=headers)

    listed = client.get(RECENTS, headers=headers).get_json()
    mine = [item for item in listed["items"] if item["resource_id"] == resource_id]
    # Upserted on the table's own unique constraint, so a place somebody works
    # accumulates a count rather than fifty rows.
    assert len(mine) == 1
    assert mine[0]["visit_count"] == 2


def test_the_recents_list_is_trimmed(client, monkeypatch):
    patch_package(monkeypatch, service, "MAX_RECENTS", 3)
    headers = _authenticate(monkeypatch)

    for index in range(5):
        resource_id = str(uuid.uuid4())
        client.post(
            RECENTS,
            json={
                "resource_type": "ticket",
                "resource_id": resource_id,
                "label": f"Trim {index}",
                "url": f"/tickets/{resource_id}",
            },
            headers=headers,
        )

    listed = client.get(RECENTS, headers=headers).get_json()
    # An unbounded by-product is a table that only grows.
    assert listed["total"] <= 3
    assert listed["kept"] == 3


def test_a_recent_says_whether_it_is_also_a_favourite(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    resource_id = str(uuid.uuid4())
    client.post(
        RECENTS,
        json={
            "resource_type": "ticket",
            "resource_id": resource_id,
            "label": "Recent and starred",
            "url": f"/tickets/{resource_id}",
        },
        headers=headers,
    )

    listing = _bookmark(
        client, headers, resource_id=resource_id, label="Recent and starred"
    )
    made = next(item for item in listing["items"] if item["resource_id"] == resource_id)

    try:
        listed = client.get(RECENTS, headers=headers).get_json()
        mine = next(item for item in listed["items"] if item["resource_id"] == resource_id)
        # So the page can offer "star this" on a recent without a request per
        # row.
        assert mine["is_favorite"] is True
    finally:
        client.delete(f"{FAVORITES}/{made['id']}", headers=headers)


def test_clearing_the_trail_leaves_the_bookmarks_alone(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    listing = _bookmark(client, headers, label="Survives a clear")
    made = next(item for item in listing["items"] if item["label"] == "Survives a clear")
    client.post(
        RECENTS,
        json={
            "resource_type": "ticket",
            "resource_id": str(uuid.uuid4()),
            "label": "Cleared",
            "url": "/tickets/x",
        },
        headers=headers,
    )

    try:
        cleared = client.delete(RECENTS, headers=headers)
        assert cleared.status_code == 200
        assert cleared.get_json()["cleared"] >= 1
        assert client.get(RECENTS, headers=headers).get_json()["total"] == 0

        # A bookmark was a decision; a recent was a by-product.
        assert any(item["id"] == made["id"] for item in _mine(client, headers)["items"])
    finally:
        client.delete(f"{FAVORITES}/{made['id']}", headers=headers)


def test_clearing_an_empty_trail_is_not_an_error(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    client.delete(RECENTS, headers=headers)
    again = client.delete(RECENTS, headers=headers)
    assert again.status_code == 200
    assert again.get_json()["cleared"] == 0


def test_somebody_elses_trail_is_not_visible(client, monkeypatch):
    from src.models.identity import User
    from src.models.personal import RecentItem

    headers = _authenticate(monkeypatch, "analyst", "analyst")
    with session_scope() as session:
        me = session.scalar(select(User).where(User.username == "analyst"))
        theirs = session.scalars(
            select(RecentItem.id).where(RecentItem.user_id != me.id).limit(20)
        ).all()
    assert theirs, "the seed has no other people's recents"

    listed = client.get(RECENTS, headers=headers).get_json()
    assert not ({item["id"] for item in listed["items"]} & {str(item) for item in theirs})
