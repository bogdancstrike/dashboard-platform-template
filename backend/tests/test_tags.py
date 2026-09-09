"""Tags — one shared vocabulary, applied to anything (§37).

The property the whole design rests on is that **the links are the truth and
the array is a derived cache with one writer**. Both stores existed before this
module and nothing kept them in step: 44 tasks carried an array and 28 had
links. So the first thing this suite asserts is that every write through the
service leaves the two agreeing, and `--check` asserts it over the whole
database.

The rest is the permission split — applying a tag is an edit, curating the
vocabulary is governance — and the refusals that keep a vocabulary a
vocabulary: a name that already exists, a name that is only a different
spelling, a tag that does not exist, and a system tag whose name other things
quote.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy import select

from src.config import Config
from src.services import tags as service
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
TAGS = f"{PREFIX}/tags"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"tags-{username}"),
    )
    return {"Authorization": f"Bearer tags-{username}"}


def _erase_tag(name: str) -> None:
    from src.core.db import session_scope
    from src.models.content import Tag, TagLink
    from src.models.platform import ActivityEntry, AuditLog

    with session_scope() as session:
        tag = session.scalars(select(Tag).where(Tag.slug == service.slugify(name))).first()
        if tag is None:
            return
        session.query(TagLink).filter(TagLink.tag_id == tag.id).delete(
            synchronize_session=False
        )
        session.query(ActivityEntry).filter(
            ActivityEntry.resource_id == str(tag.id)
        ).delete(synchronize_session=False)
        session.query(AuditLog).filter(AuditLog.resource_id == str(tag.id)).delete(
            synchronize_session=False
        )
        session.delete(tag)


@pytest.fixture()
def scratch_tag(client, monkeypatch):
    """A tag this test owns."""
    headers = _authenticate(monkeypatch)
    name = f"probe-{uuid4().hex[:8]}"
    response = client.post(
        TAGS,
        json={"name": name, "color": "#0f766e", "category": "ENGINEERING",
              "description": "Created by the tag test."},
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()
    try:
        yield response.get_json()
    finally:
        _erase_tag(name)


@pytest.fixture()
def scratch_task(client, monkeypatch):
    """A task this test owns, erased on the way out."""
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.content import TagLink
    from src.models.platform import ActivityEntry, AuditLog

    headers = _authenticate(monkeypatch)
    response = client.post(
        f"{PREFIX}/api/records/task",
        json={"title": "Tag probe", "status": "NEW", "priority": "NORMAL"},
        headers=headers,
    )
    assert response.status_code == 201, response.get_json()
    record = response.get_json()
    try:
        yield record
    finally:
        with session_scope() as session:
            session.query(TagLink).filter(TagLink.resource_id == record["id"]).delete(
                synchronize_session=False
            )
            session.query(ActivityEntry).filter(
                ActivityEntry.resource_id == record["id"]
            ).delete(synchronize_session=False)
            session.query(AuditLog).filter(AuditLog.resource_id == record["id"]).delete(
                synchronize_session=False
            )
            session.query(Task).filter(Task.id == record["id"]).delete(
                synchronize_session=False
            )


# ── the identity behind a name ───────────────────────────────────────────


def test_two_spellings_are_one_tag():
    """The rule that makes a vocabulary a vocabulary.

    Without it a filter for one spelling finds a third of the rows and reports
    it as all of them, which is the failure mode of free-text classification.
    """
    assert service.slugify("Urgent") == "urgent"
    assert service.slugify("  URGENT  ") == "urgent"
    assert service.slugify("Needs Review!") == "needs-review"
    assert service.slugify("") == ""


def test_the_vocabulary_needs_a_bearer_token(client):
    assert client.get(TAGS).status_code == 401
    assert client.post(TAGS, json={"name": "x"}).status_code == 401


@pytest.mark.database
def test_reading_the_vocabulary_needs_nothing_more_than_signing_in(client, monkeypatch):
    # A picker that cannot list the options is not a picker, and the page is
    # worth opening to find out what the tags *mean*.
    _authenticate(monkeypatch, "user", "viewer")
    response = client.get(TAGS, headers={"Authorization": "Bearer tags-user"})

    assert response.status_code == 200
    body = response.get_json()
    assert body["total"] > 0
    # And it says which permission curating them needs, rather than hiding.
    assert body["can_manage"] is False


@pytest.mark.database
def test_curating_the_vocabulary_needs_its_own_permission(client, monkeypatch):
    """A rename changes what every record carrying the tag says.

    An operator may edit records all day — including *applying* tags — and
    still not own the vocabulary, which is a different act.
    """
    _authenticate(monkeypatch, "operator", "operator")
    headers = {"Authorization": "Bearer tags-operator"}

    refused = client.post(TAGS, json={"name": "operator-tag"}, headers=headers)
    assert refused.status_code == 403
    assert refused.get_json()["details"]["missing"] == ["tags.manage"]


@pytest.mark.database
def test_a_name_that_already_exists_is_refused_by_name(client, monkeypatch, scratch_tag):
    headers = _authenticate(monkeypatch)
    # Including a different spelling of it, because they are one tag.
    for name in (scratch_tag["name"], scratch_tag["name"].upper()):
        response = client.post(TAGS, json={"name": name}, headers=headers)
        assert response.status_code == 409, name
        # Named, so the answer is "it is already there" rather than "no".
        assert response.get_json()["details"]["slug"] == scratch_tag["slug"]


@pytest.mark.database
def test_a_colour_that_is_not_a_colour_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(TAGS, json={"name": "bad-colour", "color": "red"}, headers=headers)
    assert response.status_code == 400
    assert response.get_json()["details"]["field"] == "color"


@pytest.mark.database
def test_a_system_tag_can_be_recoloured_but_not_renamed_or_removed(client, monkeypatch):
    """Its name is quoted by automations, saved searches and reports.

    Renaming it would silently change what those match; deleting it would
    silently match nothing. Recolouring changes nothing but the picture.
    """
    from src.core.db import session_scope
    from src.models.content import Tag

    headers = _authenticate(monkeypatch)
    with session_scope() as session:
        system = session.scalars(select(Tag).where(Tag.is_system.is_(True))).first()
        assert system is not None, "the seed should carry at least one system tag"
        tag_id, original_name, original_colour = str(system.id), system.name, system.color

    renamed = client.put(f"{TAGS}/{tag_id}", json={"name": "renamed"}, headers=headers)
    assert renamed.status_code == 400
    assert renamed.get_json()["details"]["is_system"] is True

    removed = client.delete(f"{TAGS}/{tag_id}", headers=headers)
    assert removed.status_code == 400
    assert removed.get_json()["details"]["is_system"] is True

    try:
        recoloured = client.put(f"{TAGS}/{tag_id}", json={"color": "#123456"}, headers=headers)
        assert recoloured.status_code == 200
        assert recoloured.get_json()["color"] == "#123456"
        # And the name is untouched, which is the whole point.
        assert recoloured.get_json()["name"] == original_name
    finally:
        client.put(f"{TAGS}/{tag_id}", json={"color": original_colour}, headers=headers)


# ── tags on a record ─────────────────────────────────────────────────────


@pytest.mark.database
def test_applying_a_tag_writes_the_links_and_the_derived_array(
    client, monkeypatch, scratch_tag, scratch_task
):
    """The property the whole design rests on.

    The links are the truth; the array is a cache with one writer. Both are
    read back from the database, because a service that returned the right
    answer and stored a different one is exactly the defect this replaces.
    """
    from src.core.db import session_scope
    from src.models.business import Task
    from src.models.content import TagLink

    headers = _authenticate(monkeypatch)
    url = f"{PREFIX}/api/records/task/{scratch_task['id']}/tags"

    response = client.put(url, json={"tags": [scratch_tag["name"], "urgent"]}, headers=headers)
    assert response.status_code == 200
    assert {tag["name"] for tag in response.get_json()["items"]} == {
        scratch_tag["name"], "urgent"
    }

    with session_scope() as session:
        links = session.scalars(
            select(TagLink).where(
                TagLink.resource_type == "task",
                TagLink.resource_id == scratch_task["id"],
            )
        ).all()
        assert len(links) == 2
        task = session.get(Task, scratch_task["id"])
        # The derived array agrees, sorted, without anybody having written it.
        assert sorted(task.tags or []) == sorted([scratch_tag["name"], "urgent"])


@pytest.mark.database
def test_the_whole_set_is_sent_so_a_tag_is_removed_by_omission(
    client, monkeypatch, scratch_tag, scratch_task
):
    """Never add-one and remove-one.

    Two people editing the same record's tags with those interleave into a set
    neither of them chose, and each sees their own change land and the other's
    vanish.
    """
    from src.core.db import session_scope
    from src.models.business import Task

    headers = _authenticate(monkeypatch)
    url = f"{PREFIX}/api/records/task/{scratch_task['id']}/tags"

    client.put(url, json={"tags": [scratch_tag["name"], "urgent"]}, headers=headers)
    left = client.put(url, json={"tags": ["urgent"]}, headers=headers)
    assert [tag["name"] for tag in left.get_json()["items"]] == ["urgent"]

    with session_scope() as session:
        assert (session.get(Task, scratch_task["id"]).tags or []) == ["urgent"]


@pytest.mark.database
def test_a_tag_that_does_not_exist_is_refused_rather_than_created(
    client, monkeypatch, scratch_task
):
    # A typo would otherwise become a permanent member of a shared vocabulary,
    # which is exactly what having a vocabulary prevents.
    headers = _authenticate(monkeypatch)
    response = client.put(
        f"{PREFIX}/api/records/task/{scratch_task['id']}/tags",
        json={"tags": ["urgnet"]},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.get_json()["details"]["unknown"] == ["urgnet"]


@pytest.mark.database
def test_more_tags_than_a_record_can_carry_is_refused_with_both_numbers(
    client, monkeypatch, scratch_task
):
    headers = _authenticate(monkeypatch)
    response = client.put(
        f"{PREFIX}/api/records/task/{scratch_task['id']}/tags",
        json={"tags": [f"tag-{index}" for index in range(service.MAX_PER_RECORD + 3)]},
        headers=headers,
    )
    assert response.status_code == 400
    assert response.get_json()["details"] == {
        "tags": service.MAX_PER_RECORD + 3,
        "limit": service.MAX_PER_RECORD,
    }


@pytest.mark.database
def test_reading_a_record_does_not_carry_the_right_to_tag_it(
    client, monkeypatch, scratch_task
):
    # Applying a tag is an edit to the record, and an analyst writes nothing.
    _authenticate(monkeypatch, "analyst", "analyst")
    headers = {"Authorization": "Bearer tags-analyst"}
    url = f"{PREFIX}/api/records/task/{scratch_task['id']}/tags"

    assert client.get(url, headers=headers).status_code == 200
    assert client.get(url, headers=headers).get_json()["can_apply"] is False
    refused = client.put(url, json={"tags": ["urgent"]}, headers=headers)
    assert refused.status_code == 403
    assert refused.get_json()["details"]["missing"] == ["records.update"]


@pytest.mark.database
def test_retagging_is_on_the_record_s_own_history(client, monkeypatch, scratch_tag, scratch_task):
    """It is a change to the record, so it belongs beside every other edit.

    An audit row against the *tag* would put "the record's classification
    moved" on a page about the vocabulary, where nobody investigating the
    record would find it (§21).
    """
    from src.core.db import session_scope
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    client.put(
        f"{PREFIX}/api/records/task/{scratch_task['id']}/tags",
        json={"tags": [scratch_tag["name"]]},
        headers=headers,
    )

    with session_scope() as session:
        rows = session.scalars(
            select(AuditLog).where(
                AuditLog.resource_type == "task",
                AuditLog.resource_id == scratch_task["id"],
                AuditLog.action == "UPDATE",
            )
        ).all()
    assert any(
        (row.state_after or {}).get("tags") == [scratch_tag["name"]] for row in rows
    )


@pytest.mark.database
def test_removing_a_tag_takes_it_off_the_records_and_says_how_many(
    client, monkeypatch, scratch_tag, scratch_task
):
    """A deleted tag must not stay on the lists forever.

    That is the failure mode of a denormalised column with no single writer,
    and it is why the array is rewritten wherever a link went.
    """
    from src.core.db import session_scope
    from src.models.business import Task

    headers = _authenticate(monkeypatch)
    client.put(
        f"{PREFIX}/api/records/task/{scratch_task['id']}/tags",
        json={"tags": [scratch_tag["name"]]},
        headers=headers,
    )

    removed = client.delete(f"{TAGS}/{scratch_tag['id']}", headers=headers)
    assert removed.status_code == 200
    # The consequence, counted: "remove urgent" and "remove urgent from nine
    # records" are different decisions.
    assert removed.get_json()["records"] == 1

    with session_scope() as session:
        assert not (session.get(Task, scratch_task["id"]).tags or [])


@pytest.mark.database
def test_renaming_a_tag_rewrites_it_wherever_it_appears(
    client, monkeypatch, scratch_tag, scratch_task
):
    """The reason the links are the truth.

    Without them a rename would be a thousand string replacements nobody could
    undo; with them it is one row and a resync.
    """
    from src.core.db import session_scope
    from src.models.business import Task

    headers = _authenticate(monkeypatch)
    client.put(
        f"{PREFIX}/api/records/task/{scratch_task['id']}/tags",
        json={"tags": [scratch_tag["name"]]},
        headers=headers,
    )
    renamed = f"{scratch_tag['name']}-renamed"
    try:
        response = client.put(
            f"{TAGS}/{scratch_tag['id']}", json={"name": renamed}, headers=headers
        )
        assert response.status_code == 200

        with session_scope() as session:
            assert (session.get(Task, scratch_task["id"]).tags or []) == [renamed]
    finally:
        _erase_tag(renamed)


@pytest.mark.database
def test_the_usage_count_follows_the_links(client, monkeypatch, scratch_tag, scratch_task):
    # The manager sorts by it, which makes it worth exactly as much as its
    # accuracy.
    headers = _authenticate(monkeypatch)
    url = f"{PREFIX}/api/records/task/{scratch_task['id']}/tags"

    def usage() -> int:
        body = client.get(TAGS, headers=headers).get_json()
        return next(
            tag["usage_count"] for tag in body["items"] if tag["id"] == scratch_tag["id"]
        )

    assert usage() == 0
    client.put(url, json={"tags": [scratch_tag["name"]]}, headers=headers)
    assert usage() == 1
    client.put(url, json={"tags": []}, headers=headers)
    assert usage() == 0


@pytest.mark.database
def test_every_entity_dataset_can_carry_tags(client, monkeypatch):
    """Orders were the one dataset that could not, for no reason at all.

    The other five tables had a `tags` column and this one did not, so a shared
    vocabulary stopped at the ledger — an asymmetry nothing would have
    reported.
    """
    from src.services.explorer import resources

    headers = _authenticate(monkeypatch)
    taggable = set(client.get(TAGS, headers=headers).get_json()["taggable"])
    assert taggable == set(resources())
    for resource in resources().values():
        assert hasattr(resource.model, "tags"), resource.key
