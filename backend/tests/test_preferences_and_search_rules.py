"""A person's own preferences and details, and the global search box's arguments.

`test_me` covers reading and saving a profile. These pin each preference
kind's validation (choices, flags, free text, sets), the details a person may
edit about themselves, and the search endpoint's argument checks and snippet
cutting.
"""

from __future__ import annotations

from uuid import uuid4

import pytest

from src.core.errors import NotFoundError, ValidationError
from src.services.people import account as me
from src.services.records import search


@pytest.mark.parametrize(("patch", "field"), [
    ([], "preferences"),
    ({}, "preferences"),
    ({"spaceship": {}}, "preferences.spaceship"),
    ({"appearance": "dark"}, "preferences.appearance"),
    ({"appearance": {"wallpaper": "cats"}}, "preferences.appearance.wallpaper"),
    ({"appearance": {"sidebar_collapsed": "yes"}}, "preferences.appearance.sidebar_collapsed"),
    ({"appearance": {"theme": "sepia"}}, "preferences.appearance.theme"),
    ({"mail": {"signature": 42}}, "preferences.mail.signature"),
    ({"notifications": {"popup_categories": "SYSTEM"}}, "preferences.notifications.popup_categories"),
    ({"notifications": {"popup_categories": ["NOT_A_CATEGORY"]}}, "preferences.notifications.popup_categories"),
])
def test_a_bad_preference_names_the_field(patch, field):
    with pytest.raises(ValidationError) as raised:
        me._validate_patch(patch)
    assert raised.value.details["field"] == field


def test_good_preferences_are_normalised():
    from src.core import vocabulary

    categories = sorted(vocabulary.NOTIFICATION_CATEGORY)[:2]
    validated = me._validate_patch({
        "appearance": {"theme": "dark", "sidebar_collapsed": True},
        "mail": {"signature": "  Regards  " + "x" * 600},
        "notifications": {"popup_categories": [categories[1], categories[0], categories[1]]},
    })
    assert validated["appearance"] == {"theme": "dark", "sidebar_collapsed": True}
    assert validated["mail"]["signature"].startswith("Regards") and len(validated["mail"]["signature"]) == 500
    assert validated["notifications"]["popup_categories"] == sorted(categories)
    merged = me.merged_preferences({"appearance": {"theme": "dark", "unknown": 1}, "mail": "garbage"})
    assert merged["appearance"]["theme"] == "dark" and "unknown" not in merged["appearance"]
    assert me.merged_preferences(None) == me.PREFERENCE_DEFAULTS


@pytest.mark.database
def test_a_person_edits_only_their_own_details(app):
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.identity import User

    with session_scope() as session:
        user = session.scalars(select(User).where(User.username == "analyst")).one()
        name = user.full_name
        for bad, field in (({}, "user"), ("x", "user"), ({"role_id": "x"}, "user.role_id"),
                           ({"phone": 5}, "user.phone"), ({"full_name": "  "}, "user.full_name")):
            with pytest.raises(ValidationError) as raised:
                me.update_profile(session, user.id, bad)
            assert raised.value.details["field"] == field
        assert me.update_profile(session, user.id, {"job_title": "  Analyst  ", "phone": ""}) == {
            "updated": ["job_title", "phone"]}
        assert user.job_title == "Analyst" and user.phone is None and user.full_name == name
        with pytest.raises(NotFoundError):
            me.update_profile(session, uuid4(), {"job_title": "x"})
        with pytest.raises(NotFoundError):
            me.update_preferences(session, uuid4(), {"appearance": {"theme": "dark"}})
        session.rollback()


def test_the_search_arguments_are_checked():
    with pytest.raises(ValidationError):
        search._per_resource({"per_resource": "many"})
    with pytest.raises(ValidationError):
        search._per_resource({"per_resource": 0})
    with pytest.raises(ValidationError):
        search._per_resource({"per_resource": search.MAX_PER_RESOURCE + 1})
    assert search._per_resource({}) == search.DEFAULT_PER_RESOURCE


def test_a_long_match_is_cut_around_the_term():
    text = "lorem ipsum " * 40 + "NEEDLE in the middle " + "dolor sit " * 40
    snippet = search._snippet(text, "needle")
    assert "NEEDLE" in snippet and snippet.startswith("…") and snippet.endswith("…")
    assert len(snippet) <= search.SNIPPET_WIDTH + 2
    assert search._snippet("short", "x") == "short"
    assert search._snippet("y" * 400, "absent").endswith("…")


@pytest.mark.database
def test_the_search_box_refuses_an_essay_and_ignores_a_letter(client, monkeypatch):
    from tests.personas import PREFIX, sign_in

    headers = sign_in(monkeypatch, "admin")
    url = f"{PREFIX}/api/search/global"
    assert client.get(url, query_string={"q": "x" * 5000}, headers=headers).status_code == 400
    assert client.get(url, query_string={"q": "a"}, headers=headers).get_json()["groups"] == []
    found = client.get(url, query_string={"q": "an", "per_resource": 1}, headers=headers).get_json()
    assert all(len(group["items"]) <= 1 for group in found["groups"])
