"""Condition → action automation (§49). — Actions."""

from __future__ import annotations

from sqlalchemy import select

from src.core.db import session_scope
from tests.conftest import persona_claims
from tests.workflows_support import (  # noqa: F401
    RULES,
    _authenticate,
    _condition,
    _mine,
    _rule,
    _run,
    pytestmark,
)


def test_a_failing_action_is_recorded_and_does_not_take_the_others_with_it(
    client, monkeypatch):
    """A webhook whose host is down must not lose the notification beside it."""
    headers = _authenticate(monkeypatch)
    rule = _rule(
        client,
        headers,
        actions=[
            # Port 1 on the loopback refuses instantly, so this test needs no
            # network and no sleep.
            {"kind": "WEBHOOK", "url": "http://127.0.0.1:1/hook"},
            {"kind": "NOTIFY", "recipients": {"owner": True}},
        ],
    )

    answer = _run(client, headers, rule["id"], dry_run=False)
    assert answer["by_action"]["WEBHOOK"]["failed"] > 0
    assert answer["by_action"]["NOTIFY"]["ok"] > 0
    # And the run itself succeeded: the rule is working, one of its actions is
    # not, and the page can say exactly that.
    assert answer["error"] is None

    with session_scope() as session:
        assert session.scalars(_mine(rule["id"])).first() is not None


def test_raising_a_task_puts_it_in_the_normal_queue(client, monkeypatch):
    """Not a private automation queue: the follow-up has to be visible work."""
    headers = _authenticate(monkeypatch)
    rule = _rule(
        client,
        headers,
        name="Chase the new work",
        actions=[{"kind": "TASK", "title": "Follow up on {record}", "priority": "HIGH"}],
    )
    _run(client, headers, rule["id"], dry_run=False)

    from src.models.business import Task

    with session_scope() as session:
        raised = session.scalars(
            select(Task).where(Task.title.like("Follow up on %"))
        ).all()
    assert raised
    assert all(item.reference.startswith("TSK-") for item in raised)
    assert all(item.priority == "HIGH" for item in raised)
    # `{record}` was filled from the record, so the task says what it is about.
    assert all(item.title != "Follow up on {record}" for item in raised)


def test_an_email_action_is_queued_into_the_mailbox_and_says_so(
    client, monkeypatch):
    """OUTBOX rather than SENT: nothing has transported it, and the folder is
    the whole claim the row makes."""
    headers = _authenticate(monkeypatch)
    rule = _rule(
        client,
        headers,
        actions=[
            {"kind": "EMAIL", "recipients": {"role": "MANAGER"},
             "subject": "{rule} matched {record}"}
        ],
    )
    _run(client, headers, rule["id"], dry_run=False)

    from src.models.content import EmailMessage

    with session_scope() as session:
        queued = session.scalars(
            select(EmailMessage).where(EmailMessage.folder == "OUTBOX")
        ).all()
    assert queued
    assert all(item.to_recipients for item in queued), "addressed to the role's holders"
    assert all("{rule}" not in (item.subject or "") for item in queued)


def test_an_email_naming_a_template_that_does_not_exist_is_refused_on_save(
    client, monkeypatch
):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Uses a missing template", "resource_type": "task",
              "condition_tree": _condition(),
              "actions": [{"kind": "EMAIL", "recipients": {"owner": True},
                           "template": "no-such-template"}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "no-such-template" in response.get_json()["message"]


def test_a_role_recipient_is_resolved_when_the_rule_fires(client, monkeypatch):
    """Resolved now and never stored: the point of addressing a role is that
    the answer changes as the team does."""
    headers = _authenticate(monkeypatch)
    rule = _rule(
        client, headers, actions=[{"kind": "NOTIFY", "recipients": {"role": "MANAGER"}}]
    )
    _run(client, headers, rule["id"], dry_run=False)

    from src.models.identity import Role, User

    with session_scope() as session:
        managers = set(
            session.scalars(
                select(User.id).join(Role, User.role_id == Role.id).where(Role.code == "MANAGER")
            ).all()
        )
        reached = {row.user_id for row in session.scalars(_mine(rule["id"])).all()}
    assert managers, "the seed has managers"
    assert reached <= managers


def test_only_the_author_changes_an_automation(client, monkeypatch):
    """It reaches other people's inboxes, so "anybody who may write one may
    rewrite yours" is the wrong default."""
    headers = _authenticate(monkeypatch, "manager", "manager")
    rule = _rule(client, headers)

    # A second person who holds the permission, and is not an administrator.
    monkeypatch.setattr(
        "src.core.auth.tokens.verify_token",
        lambda _token: persona_claims("admin", "manager", sid="auto-other"),
    )
    other = {"Authorization": "Bearer auto-other"}
    assert client.get(f"{RULES}/{rule['id']}", headers=other).status_code == 200
    assert client.put(
        f"{RULES}/{rule['id']}", json={"name": "Mine now"}, headers=other
    ).status_code == 403


def test_an_administrator_can_stop_a_rule_whose_author_has_left(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    rule = _rule(client, headers)

    admin = _authenticate(monkeypatch, "admin", "administrator")
    response = client.put(f"{RULES}/{rule['id']}", json={"enabled": False}, headers=admin)
    assert response.status_code == 200
    assert response.get_json()["enabled"] is False


def test_the_run_history_is_kept_and_distinguishes_a_rehearsal(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=0)
    _run(client, headers, rule["id"], dry_run=True)
    _run(client, headers, rule["id"], dry_run=False)

    history = client.get(f"{RULES}/{rule['id']}/runs", headers=headers).get_json()
    assert history["total"] == 2
    # Newest first, and "we tried it" is not "it happened".
    assert [item["dry_run"] for item in history["items"]] == [False, True]


def test_a_broken_condition_is_reported_as_a_failed_run_not_a_failed_request(
    client, monkeypatch):
    """"This rule has been broken since Tuesday" is what somebody needs to see.

    A field renamed out from under a stored condition cannot fail the request
    that is showing the page — the page asking is the page that has to show
    the reason.
    """
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers)

    from src.models.automation_graphs import AutomationGraph
    from src.models.platform import AlertRule

    with session_scope() as session:
        row = session.get(AlertRule, rule["id"])
        row.condition_tree = _condition("field_that_went_away", ("x",))
        # The graph is the definition the engine runs, so that is where the
        # rename has to land for the run to notice it.
        graph = session.scalar(select(AutomationGraph).where(AutomationGraph.rule_id == row.id))
        published = dict(graph.published)
        published["nodes"] = [
            {**node, "data": {"tree": _condition("field_that_went_away", ("x",))}}
            if node["type"] == "condition" else node
            for node in published["nodes"]
        ]
        graph.published = published

    answer = _run(client, headers, rule["id"], dry_run=True)
    assert answer["error"] and "field_that_went_away" in answer["error"]
    assert answer["matched"] == 0


def test_withdrawing_an_automation_pauses_it_as_well(client, monkeypatch):
    """A soft-deleted rule that is still `enabled` is a rule a scheduler reading
    only `enabled` would keep firing."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers)
    assert client.delete(f"{RULES}/{rule['id']}", headers=headers).status_code == 200

    from src.models.platform import AlertRule

    with session_scope() as session:
        row = session.get(AlertRule, rule["id"])
        assert row.deleted_at is not None
        assert row.enabled is False

    assert client.get(f"{RULES}/{rule['id']}", headers=headers).status_code == 404


def test_the_list_counts_what_is_enabled_over_the_whole_table(client, monkeypatch):
    """Computed where the rows are, not over the page (§71)."""
    headers = _authenticate(monkeypatch)
    _rule(client, headers, name="One that is on", enabled=True)
    _rule(client, headers, name="One that is off", enabled=False)

    answer = client.get(RULES, headers=headers).get_json()
    assert answer["counts"]["total"] >= 2
    assert answer["counts"]["enabled"] < answer["counts"]["total"]


def test_writing_an_automation_is_audited(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers)

    from src.models.platform import AuditLog

    with session_scope() as session:
        entry = session.scalars(
            select(AuditLog)
            .where(AuditLog.resource_type == "alert_rule", AuditLog.resource_id == rule["id"])
            .order_by(AuditLog.occurred_at.desc())
        ).first()
    assert entry is not None
    assert entry.action == "automation.create"
    # The audit keeps the parts somebody argues about afterwards.
    assert entry.state_after["condition_text"] == rule["condition_text"]
    assert entry.state_after["actions"]
