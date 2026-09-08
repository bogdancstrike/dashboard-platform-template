"""Bookmarks and recents — one store for "what have I starred" (§38, §39).

Four claims this module exists for.

**Starring a report or a saved search puts it on the favourites page.** There
were two stores and the older UI already lied about it: the saved-search
drawer's own tooltip says "Add to favourites" and wrote a boolean column, while
`favorites` — a table whose docstring reads "a bookmark on anything
addressable" — had no service at all. So the test that matters is the one that
stars a search through the *search* endpoint and then finds it through the
*favourites* endpoint.

**A star is a fact about a reader, not about the thing.** Two people can
disagree about the same shared search, which a column on the search cannot
express — and the test asserts exactly that.

**Order is somebody's arrangement.** A bookmark list is a shortcut bar, so the
order is a decision, not a sort, and re-arranging it is the only thing that can
be changed about a bookmark.

**A recent is not a favourite.** It is a by-product with a visit count, it is
upserted rather than appended, it is trimmed, and clearing the trail leaves the
bookmarks alone.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from src.services import favorites as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
FAVORITES = f"{PREFIX}/favorites"
RECENTS = f"{PREFIX}/recents"
REPORTS = f"{PREFIX}/api/reports"
SEARCHES = f"{PREFIX}/api/saved-searches"


def _authenticate(monkeypatch, username: str = "analyst", role: str = "analyst"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"fav-{username}"),
    )
    return {"Authorization": f"Bearer fav-{username}"}


def _mine(client, headers) -> dict:
    answer = client.get(FAVORITES, headers=headers)
    assert answer.status_code == 200, answer.get_json()
    return answer.get_json()


def _bookmark(client, headers, **overrides) -> dict:
    body = {
        "resource_type": "ticket",
        "resource_id": str(uuid.uuid4()),
        "label": "Bookmark test",
        "url": "/tickets/whatever",
        **overrides,
    }
    answer = client.post(FAVORITES, json=body, headers=headers)
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()


# ── what may be bookmarked ──────────────────────────────────────────────


def test_the_bookmarkable_types_come_from_the_registry():
    from src.services import explorer

    kinds = service.bookmarkable()
    # Derived, so a dataset added to the explorer becomes bookmarkable the
    # same day rather than the day somebody remembers this list.
    assert set(explorer.resources()) <= set(kinds)
    # And the personal objects with their own pages, spelled the way the
    # services that own them spell it.
    assert {"report", "saved_search", "dashboard"} <= set(kinds)


def test_a_type_nothing_addresses_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.post(
        FAVORITES,
        json={
            "resource_type": "nothing-like-this",
            "resource_id": "x",
            "label": "x",
            "url": "/x",
        },
        headers=headers,
    )
    assert answer.status_code == 400
    # A favourite that 404s is worse than no favourite, so the refusal names
    # what can be bookmarked.
    assert "available" in answer.get_json()["details"]


def test_a_bookmark_must_point_inside_the_application(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.post(
        FAVORITES,
        json={
            "resource_type": "ticket",
            "resource_id": "x",
            "label": "Elsewhere",
            "url": "https://example.test/somewhere",
        },
        headers=headers,
    )
    # A "favourite" that navigated off the platform would be a link nobody
    # expects (§76).
    assert answer.status_code == 400


def test_a_bookmark_needs_something_to_point_at(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.post(
        FAVORITES, json={"resource_type": "ticket"}, headers=headers
    )
    assert answer.status_code == 400
    assert set(answer.get_json()["details"]["missing"]) == {"resource_id", "label", "url"}


# ── the one store ───────────────────────────────────────────────────────


def test_starring_a_report_puts_it_on_the_favourites_page(client, monkeypatch):
    """The defect this whole change exists for.

    Before it, `Report.is_favorite` was a column and `/favorites` read a
    different table, so a starred report appeared on neither list the reader
    would look at.
    """
    headers = _authenticate(monkeypatch, "manager", "manager")
    made = client.post(
        REPORTS,
        json={
            "name": "Favourite test report",
            "resource_type": "ticket",
            "dimensions": ["status"],
            "metrics": ["count"],
        },
        headers=headers,
    )
    assert made.status_code in (200, 201), made.get_json()
    report = made.get_json()

    try:
        starred = client.put(
            f"{REPORTS}/{report['id']}", json={"is_favorite": True}, headers=headers
        )
        assert starred.status_code == 200
        assert starred.get_json()["is_favorite"] is True

        # The *favourites* endpoint, which is the list a reader opens.
        listed = _mine(client, headers)
        found = [
            item for item in listed["items"] if item["resource_id"] == report["id"]
        ]
        assert found, "a starred report is not on the favourites page"
        assert found[0]["resource_type"] == "report"
        assert found[0]["url"] == f"/reports/{report['id']}"
    finally:
        client.delete(f"{REPORTS}/{report['id']}", headers=headers)


def test_unstarring_a_report_takes_it_off_the_page(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    report = client.post(
        REPORTS,
        json={
            "name": "Unfavourite test report",
            "resource_type": "ticket",
            "dimensions": ["status"],
            "metrics": ["count"],
            "is_favorite": True,
        },
        headers=headers,
    ).get_json()

    try:
        assert any(
            item["resource_id"] == report["id"] for item in _mine(client, headers)["items"]
        )
        client.put(f"{REPORTS}/{report['id']}", json={"is_favorite": False}, headers=headers)
        assert not any(
            item["resource_id"] == report["id"] for item in _mine(client, headers)["items"]
        )
    finally:
        client.delete(f"{REPORTS}/{report['id']}", headers=headers)


def test_starring_a_saved_search_puts_it_on_the_page(client, monkeypatch):
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    search = client.post(
        SEARCHES,
        json={
            "name": "Favourite test search",
            "resource_type": "ticket",
            "is_favorite": True,
        },
        headers=headers,
    )
    assert search.status_code in (200, 201), search.get_json()
    saved = search.get_json()

    try:
        assert saved["is_favorite"] is True
        # The drawer's tooltip says "Add to favourites". Now it is true.
        found = [
            item
            for item in _mine(client, headers)["items"]
            if item["resource_id"] == saved["id"]
        ]
        assert found, "a starred saved search is not on the favourites page"
        assert found[0]["url"] == f"/search/saved/{saved['id']}"
    finally:
        client.delete(f"{SEARCHES}/{saved['id']}", headers=headers)


def test_two_people_can_disagree_about_the_same_shared_search(client, monkeypatch):
    """Which a column on the search cannot express.

    A star is a fact about a reader. The old design stored it on the row, so
    one person starring a shared search starred it for everybody who could see
    it — and unstarring took it away from them.
    """
    owner = _authenticate(monkeypatch, "analyst", "analyst")
    saved = client.post(
        SEARCHES,
        json={"name": "Shared favourite test", "resource_type": "ticket", "scope": "PUBLIC"},
        headers=owner,
    ).get_json()

    try:
        client.put(f"{SEARCHES}/{saved['id']}", json={"is_favorite": True}, headers=owner)
        assert client.get(f"{SEARCHES}/{saved['id']}", headers=owner).get_json()[
            "is_favorite"
        ] is True

        # Somebody else who can see it has not starred it.
        other = _authenticate(monkeypatch, "manager", "manager")
        theirs = client.get(f"{SEARCHES}/{saved['id']}", headers=other)
        assert theirs.status_code == 200
        assert theirs.get_json()["is_favorite"] is False
        assert not any(
            item["resource_id"] == saved["id"]
            for item in _mine(client, other)["items"]
        )
    finally:
        owner = _authenticate(monkeypatch, "analyst", "analyst")
        client.delete(f"{SEARCHES}/{saved['id']}", headers=owner)


def test_no_row_still_carries_the_old_flag():
    """The migration's own invariant, asserted against the database.

    `--sync-favorites` moves each flagged row into a `Favorite` and clears the
    column, so `is_favorite = false` everywhere is the steady state. A `true`
    here is a star `/favorites` cannot see.
    """
    from src.models.personal import Report, SavedSearch

    with session_scope() as session:
        stale = {
            "reports": session.scalars(
                select(Report.id).where(Report.is_favorite.is_(True))
            ).all(),
            "saved_searches": session.scalars(
                select(SavedSearch.id).where(SavedSearch.is_favorite.is_(True))
            ).all(),
        }
    assert {key: len(value) for key, value in stale.items()} == {
        "reports": 0,
        "saved_searches": 0,
    }, "run `make sync-favorites`"


# ── the deliberate list ─────────────────────────────────────────────────


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
    monkeypatch.setattr(service, "MAX_FAVORITES", 1)
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


# ── the automatic list ──────────────────────────────────────────────────


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
    monkeypatch.setattr(service, "MAX_RECENTS", 3)
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


# ── who may see it ──────────────────────────────────────────────────────


def test_no_permission_is_needed_for_your_own(client, monkeypatch):
    # A viewer holds almost nothing, and these are their own bookmarks.
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(FAVORITES, headers=headers).status_code == 200
    assert client.get(RECENTS, headers=headers).status_code == 200
    listing = _bookmark(client, headers, label="Viewer bookmark")
    made = next(item for item in listing["items"] if item["label"] == "Viewer bookmark")
    client.delete(f"{FAVORITES}/{made['id']}", headers=headers)


def test_a_caller_with_no_token_is_refused(client):
    assert client.get(FAVORITES).status_code == 401
    assert client.get(RECENTS).status_code == 401


# ── the record it leaves ────────────────────────────────────────────────


def test_a_bookmark_is_audited_but_leaves_no_activity(client, monkeypatch):
    from src.models.platform import ActivityEntry, AuditLog

    headers = _authenticate(monkeypatch)
    resource_id = str(uuid.uuid4())
    listing = _bookmark(client, headers, resource_id=resource_id, label="Audited")
    made = next(item for item in listing["items"] if item["resource_id"] == resource_id)

    try:
        with session_scope() as session:
            audited = session.scalars(
                select(AuditLog.action).where(AuditLog.resource_id == resource_id)
            ).all()
            noise = session.scalars(
                select(ActivityEntry.id).where(ActivityEntry.resource_id == resource_id)
            ).all()
        assert "favorite.add" in audited
        # One activity entry per bookmark would drown a feed in "starred a
        # ticket" (§48).
        assert noise == []
    finally:
        client.delete(f"{FAVORITES}/{made['id']}", headers=headers)
