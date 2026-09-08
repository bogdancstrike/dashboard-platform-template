"""Organizations, departments and teams (§42): the shape of the company.

Two claims this module exists for.

**Headcount is counted, not stored.** `departments.headcount` was drawn at
random before the users existed, so Support said 116 people with nobody at all
assigned to it — two numbers for one fact, and the stored one lied. The service
counts `users.department_id`, `--check` reports any department whose column
disagrees, and `--sync-org` recounts. Which is the pattern this codebase keeps
arriving at: derive it, and where a cache exists, prove it agrees.

**A department cannot become its own ancestor.** A cycle makes the tree
infinite and hangs every page that walks it, so a move that would create one is
refused with the path named — and the functions that *detect* cycles are
bounded, because the code that finds them must not be the code that hangs on
them.

The rest: the tree comes back nested and in one read; a department's people are
its own and the subtree total is a separate number, since rolling children up
makes a tree sum to more than the organisation employs; and retiring is refused
while anything is inside, because a department is a place whose foreign keys
cascade.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from src.config import Config
from src.core import vocabulary
from src.core.db import session_scope
from src.services import organizations as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
ORGS = f"{PREFIX}/admin/organizations"
DEPARTMENTS = f"{PREFIX}/admin/departments"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"org-{username}"),
    )
    return {"Authorization": f"Bearer org-{username}"}


def _any_organization(client, headers) -> dict:
    listing = client.get(f"{ORGS}?page_size=5", headers=headers).get_json()
    assert listing["items"], "the seed has no organizations"
    return listing["items"][0]


def _make_department(client, headers, organization_id: str, **extra) -> dict:
    body = {
        "name": extra.pop("name", f"Test dept {uuid.uuid4().hex[:6]}"),
        "code": extra.pop("code", f"T{uuid.uuid4().hex[:6].upper()}"),
        **extra,
    }
    answer = client.post(
        f"{ORGS}/{organization_id}/departments", headers=headers, json=body
    )
    assert answer.status_code == 201, answer.get_json()
    return answer.get_json()


# ── headcount is counted, not stored ────────────────────────────────────


def test_a_departments_people_are_counted_from_where_they_sit(client, monkeypatch):
    """Not read from `headcount`.

    That column said 116 for a department with nobody in it, because it was
    drawn at random before the users existed. `users.department_id` is the
    fact, and this asserts the API agrees with it for every department at
    once.
    """
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()

    from src.models.identity import User

    def walk(nodes):
        for node in nodes:
            yield node
            yield from walk(node["children"])

    with session_scope() as session:
        for node in walk(answer["departments"]):
            actual = int(
                session.scalar(
                    select(func.count())
                    .select_from(User)
                    .where(
                        User.department_id == uuid.UUID(node["id"]),
                        User.deleted_at.is_(None),
                    )
                )
                or 0
            )
            assert node["people"] == actual, node["name"]


def test_the_stored_column_is_not_allowed_to_disagree(client, monkeypatch):
    """`--check` reports the drift and `--sync-org` fixes it, so the column is
    not a lie for anything reading it directly. Asserted of the *database*,
    which is what an installation actually has."""
    from src.models.identity import Department, User

    with session_scope() as session:
        actual = dict(
            session.execute(
                select(User.department_id, func.count())
                .where(User.department_id.is_not(None), User.deleted_at.is_(None))
                .group_by(User.department_id)
            ).all()
        )
        wrong = [
            (row.name, row.headcount, int(actual.get(row.id, 0)))
            for row in session.scalars(
                select(Department).where(Department.deleted_at.is_(None))
            ).all()
            if int(row.headcount or 0) != int(actual.get(row.id, 0))
        ]
    assert not wrong, f"run 'make sync-org' — {wrong[:3]}"
    assert _authenticate(monkeypatch)  # the fixture is what proves the persona exists


def test_a_new_department_starts_with_nobody(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    created = _make_department(client, headers, organization["id"])
    assert created["people"] == 0


def test_a_departments_own_people_and_its_subtrees_are_two_numbers(client, monkeypatch):
    """Rolling children into a parent makes the numbers on a tree sum to more
    than the organisation employs — which is the same defect the other way
    round."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()

    for node in answer["departments"]:
        own = node["people"]
        subtree = node["people_in_subtree"]
        assert subtree >= own, node["name"]
        assert subtree == own + sum(child["people_in_subtree"] for child in node["children"])


def test_the_tree_says_how_many_people_sit_nowhere(client, monkeypatch):
    """The number that explains a tree summing to less than the organisation's
    own headcount — otherwise somebody spends an afternoon looking for the
    missing forty."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()

    placed = sum(node["people_in_subtree"] for node in answer["departments"])
    assert placed + answer["unassigned_people"] == answer["organization"]["people"]


def test_the_record_and_the_accounts_are_kept_apart(client, monkeypatch):
    """A tenant of 4,000 staff with 30 user accounts is normal. Conflating
    `employee_count` with the number of people the platform holds would make
    one of the two a lie."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    assert "employee_count" in organization
    assert "people" in organization


# ── the tree ─────────────────────────────────────────────────────────────


def test_the_tree_comes_back_nested_with_teams_inside_it(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()

    assert answer["departments"], "the seed gives every organization departments"
    assert all(node["depth"] == 0 for node in answer["departments"])
    # The seed nests some, so at least one organisation has a second level.
    assert answer["depth"] >= 1
    for node in answer["departments"]:
        for child in node["children"]:
            assert child["parent_id"] == node["id"]
            assert child["depth"] == 1


def test_a_team_belonging_to_no_department_is_named_rather_than_hidden(client, monkeypatch):
    """A team nobody can find on the tree is a team somebody creates a second
    copy of."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()
    assert "unplaced_teams" in answer


def test_an_organization_that_does_not_exist_says_so(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    assert client.get(f"{ORGS}/{uuid.uuid4()}", headers=headers).status_code == 404


# ── the cycle refusal ────────────────────────────────────────────────────


def test_a_department_cannot_sit_inside_itself(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    department = _make_department(client, headers, organization["id"])

    answer = client.put(
        f"{DEPARTMENTS}/{department['id']}",
        headers=headers,
        json={"parent_id": department["id"]},
    )
    assert answer.status_code == 409
    assert "inside itself" in answer.get_json()["message"]


def test_a_department_cannot_sit_inside_its_own_child(client, monkeypatch):
    """The version that actually happens: two moves that each look fine and
    together make the tree infinite. The refusal names the path, because
    "invalid parent" leaves somebody guessing which of four levels was wrong.
    """
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    grandparent = _make_department(client, headers, organization["id"], name="Cycle top")
    parent = _make_department(
        client, headers, organization["id"], name="Cycle middle", parent_id=grandparent["id"]
    )
    child = _make_department(
        client, headers, organization["id"], name="Cycle bottom", parent_id=parent["id"]
    )

    answer = client.put(
        f"{DEPARTMENTS}/{grandparent['id']}", headers=headers, json={"parent_id": child["id"]}
    )
    assert answer.status_code == 409
    body = answer.get_json()
    assert "inside itself" in body["message"]
    # The path, so the operator can see where the loop closes.
    assert "Cycle top" in body["message"]
    assert len(body["details"]["path"]) == 3


def test_the_ancestry_walk_terminates_even_on_a_broken_tree(client, monkeypatch):
    """The function that detects cycles must not be the one that hangs on them.

    Written directly against a cycle the API refuses to create, because the
    guarantee is about the code and not about whether the data can reach that
    state.
    """
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    first = _make_department(client, headers, organization["id"], name="Loop one")
    second = _make_department(
        client, headers, organization["id"], name="Loop two", parent_id=first["id"]
    )

    from src.models.identity import Department

    with session_scope() as session:
        # Forced past the API, which is the only way this state exists.
        top = session.get(Department, uuid.UUID(first["id"]))
        top.parent_id = uuid.UUID(second["id"])
        session.flush()

        chain = service._ancestry(session, top)
        assert len(chain) <= service.MAX_DEPTH + 2
        assert service._depth_of(session, top) <= service.MAX_DEPTH + 2

        # Put it back so the autouse cleanup can delete both.
        top.parent_id = None
    assert headers


def test_the_structure_has_a_depth_limit(client, monkeypatch):
    """A legibility limit rather than a technical one: four levels is already
    more nesting than anybody holds in their head, and the indentation runs
    out of room before the data runs out of depth."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)

    parent_id = None
    made = []
    for level in range(service.MAX_DEPTH):
        body = {"name": f"Deep {level}", "code": f"DEEP{level}"}
        if parent_id:
            body["parent_id"] = parent_id
        answer = client.post(f"{ORGS}/{organization['id']}/departments", headers=headers, json=body)
        if answer.status_code == 409:
            # The limit, reached.
            assert answer.get_json()["details"]["max_depth"] == service.MAX_DEPTH
            assert level > 0
            return
        assert answer.status_code == 201, answer.get_json()
        made.append(answer.get_json())
        parent_id = answer.get_json()["id"]

    # If every level was allowed, one more must not be.
    answer = client.post(
        f"{ORGS}/{organization['id']}/departments",
        headers=headers,
        json={"name": "Too deep", "code": "TOODEEP", "parent_id": parent_id},
    )
    assert answer.status_code == 409
    assert answer.get_json()["details"]["max_depth"] == service.MAX_DEPTH


def test_a_department_cannot_move_into_another_organization(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{ORGS}?page_size=5", headers=headers).get_json()
    if len(listing["items"]) < 2:
        pytest.skip("only one organization is seeded")

    first, second = listing["items"][0], listing["items"][1]
    mine = _make_department(client, headers, first["id"], name="Stays put")
    theirs = client.get(f"{ORGS}/{second['id']}", headers=headers).get_json()
    if not theirs["departments"]:
        pytest.skip("the second organization has no departments")

    answer = client.put(
        f"{DEPARTMENTS}/{mine['id']}",
        headers=headers,
        json={"parent_id": theirs["departments"][0]["id"]},
    )
    assert answer.status_code == 400
    assert "another organization" in answer.get_json()["message"]


# ── departments ──────────────────────────────────────────────────────────


def test_a_code_is_upper_cased_rather_than_refused(client, monkeypatch):
    """`eng` and `ENG` are the same code to everybody except a string
    comparison, and refusing one would enforce a rule nobody can see."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    created = _make_department(client, headers, organization["id"], code="lower-1")
    assert created["code"] == "LOWER-1"


def test_two_departments_in_one_organization_cannot_share_a_code(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    first = _make_department(client, headers, organization["id"], code="DUPE1")

    answer = client.post(
        f"{ORGS}/{organization['id']}/departments",
        headers=headers,
        json={"name": "Second", "code": "dupe1"},
    )
    assert answer.status_code == 409
    assert first["code"] in answer.get_json()["details"]["code"]


@pytest.mark.parametrize("code", ["", "x", "has space", "-leading", "a" * 33])
def test_a_code_that_will_not_do_is_refused(client, monkeypatch, code):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.post(
        f"{ORGS}/{organization['id']}/departments",
        headers=headers,
        json={"name": "Bad code", "code": code},
    )
    assert answer.status_code == 400


def test_a_department_can_be_renamed_and_moved_to_the_top(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    parent = _make_department(client, headers, organization["id"], name="Old parent")
    child = _make_department(
        client, headers, organization["id"], name="Was nested", parent_id=parent["id"]
    )

    answer = client.put(
        f"{DEPARTMENTS}/{child['id']}",
        headers=headers,
        json={"name": "Now a root", "parent_id": None},
    )
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["name"] == "Now a root"
    assert body["parent_id"] is None


# ── retiring ─────────────────────────────────────────────────────────────


def test_a_department_with_people_in_it_cannot_be_retired(client, monkeypatch):
    """A department is a *place*, unlike a group which is a set — and the
    foreign keys cascade, so a silent delete would take its teams with it and
    leave its people pointing at nothing."""
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    tree = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()

    occupied = next(
        (node for node in tree["departments"] if node["people"] > 0 or node["children"]),
        None,
    )
    if occupied is None:
        pytest.skip("no seeded department has anything in it")

    answer = client.delete(f"{DEPARTMENTS}/{occupied['id']}", headers=headers)
    assert answer.status_code == 409
    assert "Move them first" in answer.get_json()["message"]
    # And the message says what is in the way, in the words somebody needs.
    details = answer.get_json()["details"]
    assert details["people"] + details["teams"] + details["children"] > 0


def test_an_empty_department_is_retired(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    created = _make_department(client, headers, organization["id"], name="Empty and going")

    answer = client.delete(f"{DEPARTMENTS}/{created['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["deleted"] is True

    tree = client.get(f"{ORGS}/{organization['id']}", headers=headers).get_json()

    def walk(nodes):
        for node in nodes:
            yield node["id"]
            yield from walk(node["children"])

    assert created["id"] not in set(walk(tree["departments"]))


def test_a_sub_department_blocks_its_parent(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    parent = _make_department(client, headers, organization["id"], name="Blocked parent")
    _make_department(client, headers, organization["id"], name="Blocking child", parent_id=parent["id"])

    answer = client.delete(f"{DEPARTMENTS}/{parent['id']}", headers=headers)
    assert answer.status_code == 409
    assert answer.get_json()["details"]["children"] == 1


# ── the organisation record ──────────────────────────────────────────────


def test_a_tenants_details_can_be_edited(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)

    answer = client.put(
        f"{ORGS}/{organization['id']}",
        headers=headers,
        json={"industry": "Logistics", "city": "Rotterdam", "employee_count": 4200},
    )
    assert answer.status_code == 200
    body = answer.get_json()
    assert body["industry"] == "Logistics"
    assert body["employee_count"] == 4200


def test_a_tier_outside_the_vocabulary_is_refused_with_the_choices(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.put(f"{ORGS}/{organization['id']}", headers=headers, json={"tier": "PLATINUM"})
    assert answer.status_code == 400
    assert answer.get_json()["details"]["allowed"] == list(vocabulary.ORG_TIER)


def test_a_negative_employee_count_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    organization = _any_organization(client, headers)
    answer = client.put(
        f"{ORGS}/{organization['id']}", headers=headers, json={"employee_count": -5}
    )
    assert answer.status_code == 400


def test_the_tiers_in_the_database_are_all_declared(client, monkeypatch):
    """A tier only in a seeded row is one the page's filter cannot offer."""
    headers = _authenticate(monkeypatch)
    listing = client.get(f"{ORGS}?page_size=100", headers=headers).get_json()
    tiers = {row["tier"] for row in listing["items"]}
    assert tiers <= set(vocabulary.ORG_TIER), tiers - set(vocabulary.ORG_TIER)


def test_the_catalogue_carries_the_regions_and_the_reader_s_own_tenant(client, monkeypatch):
    """So the page opens on the tenant somebody belongs to rather than guessing
    which of four to show."""
    headers = _authenticate(monkeypatch)
    answer = client.get(f"{ORGS}/catalogue", headers=headers).get_json()
    assert answer["regions"], "the seed has regions"
    assert all(region["timezone"] for region in answer["regions"])
    assert answer["tiers"] == list(vocabulary.ORG_TIER)
    assert answer["max_depth"] == service.MAX_DEPTH


# ── permissions ──────────────────────────────────────────────────────────


def test_reading_the_structure_needs_only_the_directory(client, monkeypatch):
    """Where somebody sits is directory information, so `users.view` reads it."""
    headers = _authenticate(monkeypatch, "user", "viewer")
    assert client.get(ORGS, headers=headers).status_code == 200
    assert client.get(f"{ORGS}/catalogue", headers=headers).status_code == 200


def test_changing_it_needs_orgs_manage(client, monkeypatch):
    """A manager holds `users.manage` and not `orgs.manage`: managing people is
    not the same as redrawing the company."""
    admin = _authenticate(monkeypatch)
    organization = _any_organization(client, admin)

    manager = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(f"{ORGS}/{organization['id']}", headers=manager).status_code == 200
    assert (
        client.put(f"{ORGS}/{organization['id']}", headers=manager, json={"city": "Nope"}).status_code
        == 403
    )
    assert (
        client.post(
            f"{ORGS}/{organization['id']}/departments",
            headers=manager,
            json={"name": "Nope", "code": "NOPE"},
        ).status_code
        == 403
    )


def test_the_catalogue_says_whether_the_reader_may_change_anything(client, monkeypatch):
    admin = client.get(f"{ORGS}/catalogue", headers=_authenticate(monkeypatch)).get_json()
    assert admin["can_manage"] is True

    manager = client.get(
        f"{ORGS}/catalogue", headers=_authenticate(monkeypatch, "manager", "manager")
    ).get_json()
    assert manager["can_manage"] is False


def test_a_tenants_revenue_is_not_directory_information(client, monkeypatch):
    """Reading the structure is open at `users.view`, which every role holds —
    so the one commercially sensitive field on the record is withheld unless
    the reader may manage organisations. Withheld rather than zeroed, so a
    reader can tell "not shown to you" from "nothing"."""
    admin = _authenticate(monkeypatch)
    mine = _any_organization(client, admin)
    assert "annual_revenue" in mine

    viewer = _authenticate(monkeypatch, "user", "viewer")
    theirs = client.get(f"{ORGS}?page_size=5", headers=viewer).get_json()["items"][0]
    assert "annual_revenue" not in theirs
    # But the structure itself is readable: that is the point of the split.
    assert theirs["people"] >= 0
    assert theirs["name"]

    tree = client.get(f"{ORGS}/{mine['id']}", headers=viewer).get_json()
    assert "annual_revenue" not in tree["organization"]
    assert tree["departments"] is not None
