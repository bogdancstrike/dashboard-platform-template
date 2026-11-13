"""Bookmarks and recents — one store for "what have I starred" (§38, §39). — what may be bookmarked."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from src.services.records import favorites as service
from tests.favorites_support import (  # noqa: F401
    FAVORITES,
    REPORTS,
    SEARCHES,
    _authenticate,
    _mine,
    pytestmark,
)


def test_the_bookmarkable_types_come_from_the_registry():
    from src.services.records import explorer

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
