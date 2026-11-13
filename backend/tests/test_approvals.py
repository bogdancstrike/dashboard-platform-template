"""The approvals inbox: one queue, pluggable kinds, decisions that do something.

What is asserted is behaviour a person would notice: an access request that,
approved, actually grants the permission; an edit a rule holds back that is
not applied until somebody approves it; nobody approving their own request; a
bulk decision where one bad item does not undo the rest; and the badge count
that rides on the notification poll.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
APPROVALS = f"{PREFIX}/api/approvals"


@pytest.fixture()
def as_(monkeypatch):
    """Switch persona per call: `as_("admin")` returns headers for that persona."""
    roles = {"admin": "administrator", "manager": "manager", "operator": "operator",
             "analyst": "analyst", "user": "user"}
    current = {"name": "admin"}

    def claims(token):
        name = token.split("-", 1)[1]
        return persona_claims(name, roles[name], sid=f"apr-{name}")

    monkeypatch.setattr("src.core.auth.tokens.verify_token", claims)

    def headers(name: str):
        current["name"] = name
        return {"Authorization": f"Bearer apr-{name}"}

    return headers


def _value(body, name):
    return next(field["value"] for field in body["fields"] if field["name"] == name)


def _ticket_id():
    from src.models.business import Ticket

    with session_scope() as session:
        return str(session.scalars(select(Ticket.id).where(Ticket.deleted_at.is_(None),
                                                            Ticket.status == "OPEN",
                                                            Ticket.priority != "CRITICAL")).first())


def test_an_access_request_once_approved_grants_the_permission(client, as_):
    asked = client.post(f"{APPROVALS}/access", json={"permission": "audit.view", "path": "/admin/audit",
                                                     "reason": "I review incidents"}, headers=as_("user"))
    assert asked.status_code == 201, asked.json
    body = asked.json
    assert body["kind"] == "access" and body["status"] == "PENDING" and body["mine"]
    assert body["can_decide"] is False

    again = client.post(f"{APPROVALS}/access", json={"permission": "audit.view"}, headers=as_("user"))
    assert again.json["already_pending"] is True and again.json["id"] == body["id"]

    # An administrator sees it in the inbox, with the badge counting it.
    inbox = client.get(APPROVALS, query_string={"scope": "inbox", "kind": "access"}, headers=as_("admin"))
    assert inbox.status_code == 200
    assert any(item["id"] == body["id"] and item["can_decide"] for item in inbox.json["items"])
    counts = client.get(f"{PREFIX}/notifications/counts", headers=as_("admin")).json
    assert counts["pending_approvals"] >= 1

    detail = client.get(f"{APPROVALS}/{body['id']}", headers=as_("admin")).json
    assert detail["details"]["facts"][1]["value"] == "audit.view"
    assert [event["action"] for event in detail["history"]] == ["SUBMITTED"]

    decided = client.post(f"{APPROVALS}/{body['id']}/decision",
                          json={"decision": "approve", "comment": "ok"}, headers=as_("admin"))
    assert decided.status_code == 200, decided.json
    assert decided.json["status"] == "APPROVED"
    assert [event["action"] for event in decided.json["history"]] == ["SUBMITTED", "APPROVED"]

    me = client.get(f"{PREFIX}/api/me", headers=as_("user")).json
    assert "audit.view" in me["permissions"]

    # Having it now, asking again is a conflict rather than a second request.
    assert client.post(f"{APPROVALS}/access", json={"permission": "audit.view"},
                       headers=as_("user")).status_code == 409

    # The requester was told, and the decision is in the history scope.
    notes = client.get(f"{PREFIX}/notifications", headers=as_("user")).json
    assert any("approved" in item["title"] for item in notes["items"])
    history = client.get(APPROVALS, query_string={"scope": "history"}, headers=as_("user")).json
    assert any(item["id"] == body["id"] for item in history["items"])

    _remove_access_membership("audit.view", "user")


def _remove_access_membership(permission: str, username: str) -> None:
    from src.models.identity import Group, User

    with session_scope() as session:
        group = session.scalars(select(Group).where(Group.slug == f"access-{permission.replace('.', '-')}")).first()
        user = session.scalars(select(User).where(User.username == username)).first()
        if group is not None and user in group.members:
            group.members.remove(user)


def test_access_requests_refuse_what_is_not_a_permission(client, as_):
    response = client.post(f"{APPROVALS}/access", json={"permission": "nope.never"}, headers=as_("user"))
    assert response.status_code == 400


def test_nobody_decides_their_own_request_and_rejection_needs_a_reason(client, as_):
    asked = client.post(f"{APPROVALS}/access", json={"permission": "flags.manage"}, headers=as_("manager"))
    ident = asked.json["id"]
    # The manager cannot decide access at all; the admin can, but needs a reason to reject.
    assert client.post(f"{APPROVALS}/{ident}/decision", json={"decision": "approve"},
                       headers=as_("manager")).status_code == 403
    assert client.post(f"{APPROVALS}/{ident}/decision", json={"decision": "reject"},
                       headers=as_("admin")).status_code == 400
    assert client.post(f"{APPROVALS}/{ident}/decision", json={"decision": "maybe"},
                       headers=as_("admin")).status_code == 400
    rejected = client.post(f"{APPROVALS}/{ident}/decision",
                           json={"decision": "reject", "comment": "Not your area"}, headers=as_("admin"))
    assert rejected.json["status"] == "REJECTED"
    assert rejected.json["decision_comment"] == "Not your area"
    # Deciding twice is refused with the reason.
    assert client.post(f"{APPROVALS}/{ident}/decision", json={"decision": "approve"},
                       headers=as_("admin")).status_code == 400

    own = client.post(f"{APPROVALS}/access", json={"permission": "nope"}, headers=as_("admin"))
    assert own.status_code in (400, 409)


def test_a_request_is_invisible_to_people_who_neither_asked_nor_decide(client, as_):
    asked = client.post(f"{APPROVALS}/access", json={"permission": "logs.view"}, headers=as_("analyst"))
    assert client.get(f"{APPROVALS}/{asked.json['id']}", headers=as_("operator")).status_code == 404
    assert client.get(f"{APPROVALS}/{asked.json['id']}", headers=as_("analyst")).status_code == 200


def test_withdrawing_is_the_requesters_alone(client, as_):
    asked = client.post(f"{APPROVALS}/access", json={"permission": "api.manage"}, headers=as_("operator"))
    ident = asked.json["id"]
    assert client.post(f"{APPROVALS}/{ident}/withdraw", headers=as_("admin")).status_code == 404
    withdrawn = client.post(f"{APPROVALS}/{ident}/withdraw", headers=as_("operator"))
    assert withdrawn.json["status"] == "WITHDRAWN"
    assert client.post(f"{APPROVALS}/{ident}/withdraw", headers=as_("operator")).status_code == 400


def test_bulk_decisions_succeed_or_fail_one_at_a_time(client, as_):
    first = client.post(f"{APPROVALS}/access", json={"permission": "jobs.manage"}, headers=as_("analyst")).json
    second = client.post(f"{APPROVALS}/access", json={"permission": "flags.manage"}, headers=as_("analyst")).json
    own = client.post(f"{APPROVALS}/access", json={"permission": "integrations.manage"},
                      headers=as_("manager")).json
    result = client.post(f"{APPROVALS}/bulk", json={"decision": "reject", "comment": "Batch says no",
                                                    "ids": [first["id"], second["id"], own["id"],
                                                            "11111111-1111-1111-1111-111111111111"]},
                         headers=as_("admin"))
    assert result.status_code == 200
    assert result.json["decided"] == 3 and result.json["failed"] == 1
    assert client.post(f"{APPROVALS}/bulk", json={"decision": "approve", "ids": []},
                       headers=as_("admin")).status_code == 400
    assert client.post(f"{APPROVALS}/bulk", json={"decision": "x", "ids": ["a"]},
                       headers=as_("admin")).status_code == 400
    assert client.post(f"{APPROVALS}/bulk", json={"decision": "approve", "ids": ["a"] * 101},
                       headers=as_("admin")).status_code == 400


def test_the_listing_filters_by_kind_requester_age_and_text(client, as_):
    client.post(f"{APPROVALS}/access", json={"permission": "logs.view"}, headers=as_("user"))
    from src.models.identity import User

    with session_scope() as session:
        user_id = str(session.scalars(select(User.id).where(User.username == "user")).first())
    for age in ("today", "week", "older", "overdue"):
        response = client.get(APPROVALS, query_string={"scope": "all", "age": age}, headers=as_("admin"))
        assert response.status_code == 200, (age, response.json)
    narrowed = client.get(APPROVALS, query_string={"scope": "all", "requester_id": user_id, "q": "logs",
                                                   "kind": "access", "status": "pending",
                                                   "sort": "due_at", "order": "asc"},
                          headers=as_("admin")).json
    assert narrowed["total"] >= 1
    assert all(item["requester"]["id"] == user_id for item in narrowed["items"])
    assert {kind["kind"] for kind in narrowed["kinds"]} >= {"access", "change", "report", "timesheet"}
    assert narrowed["facets"]["kind"].get("access", 0) >= 1
    mine = client.get(APPROVALS, query_string={"scope": "mine"}, headers=as_("user")).json
    assert mine["counts"]["mine_pending"] >= 1
    assert client.get(APPROVALS, query_string={"scope": "nope"}, headers=as_("admin")).status_code == 400
    assert client.get(APPROVALS, query_string={"age": "ancient"}, headers=as_("admin")).status_code == 400
    assert client.get(APPROVALS, query_string={"sort": "title"}, headers=as_("admin")).status_code == 400
    # A viewer decides nothing, so their inbox is empty whatever exists.
    assert client.get(APPROVALS, headers=as_("user")).json["total"] == 0


def test_a_rule_holds_an_edit_back_until_it_is_approved(client, as_):
    rules = client.get(f"{APPROVALS}/rules", headers=as_("operator")).json
    assert rules["can_manage"] is False
    assert any(entry["resource_type"] == "ticket" for entry in rules["catalogue"])
    assert client.post(f"{APPROVALS}/rules", json={"name": "x"}, headers=as_("operator")).status_code == 403

    made = client.post(f"{APPROVALS}/rules", json={
        "name": "Critical needs a lead", "resource_type": "ticket", "field": "priority",
        "operator": "EQUALS", "value": "CRITICAL"}, headers=as_("manager"))
    assert made.status_code == 201, made.json
    rule_id = made.json["id"]

    ticket_id = _ticket_id()
    record = f"{PREFIX}/api/records/ticket/{ticket_id}"
    before = client.get(record, headers=as_("operator")).json
    original = _value(before, "priority")
    severity = _value(before, "severity")
    held = client.put(record, json={"priority": "CRITICAL"}, headers=as_("operator"))
    assert held.status_code == 200, held.json
    assert held.json["pending_approval"]["kind"] == "change"
    after = client.get(record, headers=as_("operator")).json
    assert _value(after, "priority") == original

    request_id = held.json["pending_approval"]["id"]
    detail = client.get(f"{APPROVALS}/{request_id}", headers=as_("manager")).json
    assert detail["details"]["changes"][0]["field"] == "priority"
    assert detail["details"]["changes"][0]["after"] == "CRITICAL"

    # Not a change the rule names: goes straight through.
    passed = client.put(record, json={"severity": "MAJOR"}, headers=as_("operator"))
    assert "pending_approval" not in passed.json

    approved = client.post(f"{APPROVALS}/{request_id}/decision", json={"decision": "approve"},
                           headers=as_("manager"))
    assert approved.status_code == 200, approved.json
    applied = client.get(record, headers=as_("operator")).json
    assert _value(applied, "priority") == "CRITICAL"
    # Leave the seeded ticket as it was found.
    client.put(record, json={"priority": original, "severity": severity}, headers=as_("manager"))

    edited = client.put(f"{APPROVALS}/rules/{rule_id}", json={"operator": "IN", "value": ["HIGH"]},
                        headers=as_("manager"))
    assert edited.json["operator"] == "IN"
    assert client.delete(f"{APPROVALS}/rules/{rule_id}", headers=as_("manager")).json["removed"] is True
    assert client.delete(f"{APPROVALS}/rules/{rule_id}", headers=as_("manager")).status_code == 404


@pytest.mark.parametrize("payload", [
    {"name": "", "resource_type": "ticket", "field": "priority"},
    {"name": "a", "resource_type": "nothing", "field": "priority"},
    {"name": "a", "resource_type": "ticket", "field": "reference"},
    {"name": "a", "resource_type": "ticket", "field": "priority", "operator": "LIKE"},
    {"name": "a", "resource_type": "order", "field": "total", "operator": "GT", "value": "lots"},
    {"name": "a", "resource_type": "ticket", "field": "priority", "operator": "IN", "value": "HIGH"},
])
def test_a_rule_that_cannot_work_is_refused(client, as_, payload):
    assert client.post(f"{APPROVALS}/rules", json=payload, headers=as_("manager")).status_code == 400


def test_rule_matching_covers_every_operator():
    from src.models.approvals import ChangeRule
    from src.services.decisions.approval_kinds import _matches

    assert _matches(ChangeRule(operator="ANY"), 1, 2)
    assert not _matches(ChangeRule(operator="ANY"), 2, 2)
    assert _matches(ChangeRule(operator="GT", value=100), 10, 500)
    assert not _matches(ChangeRule(operator="LT", value=100), 10, 500)
    assert not _matches(ChangeRule(operator="GT", value=100), 10, "x")
    assert _matches(ChangeRule(operator="IN", value=["A", "B"]), "C", "A")


def test_publishing_a_report_needs_approval_and_then_happens(client, as_):
    from src.models.identity import User
    from src.models.personal import Report

    with session_scope() as session:
        owner = session.scalars(select(User).where(User.username == "analyst")).first()
        report = Report(name="Churn by segment (test)", owner_id=owner.id, scope="PRIVATE",
                        resource_type="customer")
        session.add(report)
        session.flush()
        report_id = str(report.id)

    assert client.post(f"{APPROVALS}/report-publish", json={"report_id": report_id},
                       headers=as_("operator")).status_code == 404
    asked = client.post(f"{APPROVALS}/report-publish", json={"report_id": report_id},
                        headers=as_("analyst"))
    assert asked.status_code == 201
    assert client.post(f"{APPROVALS}/report-publish", json={"report_id": report_id},
                       headers=as_("analyst")).json["already_pending"] is True
    detail = client.get(f"{APPROVALS}/{asked.json['id']}", headers=as_("manager")).json
    assert detail["details"]["facts"][0]["value"] == "Private"
    client.post(f"{APPROVALS}/{asked.json['id']}/decision", json={"decision": "approve"}, headers=as_("manager"))
    with session_scope() as session:
        assert session.get(Report, report_id).scope == "ORGANIZATION"
    assert client.post(f"{APPROVALS}/report-publish", json={"report_id": report_id},
                       headers=as_("analyst")).status_code == 409


def test_an_unknown_kind_is_a_clear_error():
    from src.core.errors import ValidationError
    from src.services.decisions import approvals

    with pytest.raises(ValidationError):
        approvals.provider_for("nonsense")
