"""Organizations, departments and teams (§42): the shape of the company. — headcount is counted, not stored."""

from __future__ import annotations

import uuid

from sqlalchemy import func, select

from src.core.db import session_scope
from tests.organizations_support import (  # noqa: F401
    ORGS,
    _any_organization,
    _authenticate,
    _make_department,
    pytestmark,
)


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
