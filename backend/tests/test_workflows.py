"""Condition → action automation (§49).

What is worth asserting is what makes an automation trustworthy rather than
merely present:

  * the rule that fires is the rule the inspector showed — both come from
    `core/rules`, so the stored text cannot drift from the compiled condition;
  * a dry run reports and changes nothing, and reports the *same* matches the
    real run then acts on;
  * the cooldown is held per record, so one run does not send forty messages
    and then go quiet about the forty-first;
  * an action that fails is recorded and does not take the action beside it
    with it;
  * a rule that cannot work is refused when somebody is still looking at it —
    no actions, an unknown action, a webhook that is not a URL, a condition
    naming a field that is not there;
  * and only its author can change it, because it reaches other people.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from src.config import Config
from src.core.db import session_scope
from src.services import workflows as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
RULES = f"{PREFIX}/api/automations/rules"
CATALOG = f"{PREFIX}/api/automations/catalog"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"auto-{username}"),
    )
    return {"Authorization": f"Bearer auto-{username}"}


def _condition(field: str = "status", values: tuple[str, ...] = ("NEW",)) -> dict:
    """One rule in the shape react-awesome-query-builder exports."""
    return {
        "type": "group",
        "conjunction": "AND",
        "children1": {
            "a": {
                "type": "rule",
                "properties": {
                    "field": field,
                    "operator": "select_any_in",
                    "value": [list(values)],
                },
            }
        },
    }


def _rule(client, headers, **overrides):
    payload = {
        "name": "Test automation",
        "resource_type": "task",
        "condition_tree": _condition(),
        "actions": [
            {"kind": "NOTIFY", "recipients": {"owner": True}, "title": "{rule}: {record}"}
        ],
        "cooldown_minutes": 60,
    }
    payload.update(overrides)
    response = client.post(RULES, json=payload, headers=headers)
    assert response.status_code == 201, response.get_data(as_text=True)
    return response.get_json()


def _mine(rule_id: str):
    """Notifications *this rule* wrote.

    Scoped by `group_key` and never by category: a query for every `ALERT`
    notification passes on a clean database and fails the moment anything else
    has written one — which is what the Playwright suite does two minutes
    later, and the failure then lands on a test that changed nothing.
    """
    from src.models.platform import Notification

    return select(Notification).where(Notification.group_key == f"automation:{rule_id}")


def _run(client, headers, rule_id, *, dry_run=True):
    response = client.post(
        f"{RULES}/{rule_id}/run", json={"dry_run": dry_run}, headers=headers
    )
    assert response.status_code == 200, response.get_data(as_text=True)
    return response.get_json()


# ── Access ───────────────────────────────────────────────────────────────


def test_the_automation_endpoints_need_a_bearer_token(client):
    assert client.get(RULES).status_code == 401
    assert client.get(CATALOG).status_code == 401


def test_reading_the_automations_is_privileged(client, monkeypatch):
    """A rule's condition quotes values from records its reader may not see.

    So the permission gates the *list*, not only the writing — which is the
    opposite of announcements, where reading is what everybody does.
    """
    headers = _authenticate(monkeypatch, "analyst", "analyst")
    assert client.get(RULES, headers=headers).status_code == 403


def test_a_manager_may_write_automations(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    assert client.get(RULES, headers=headers).status_code == 200


# ── The catalogue the editor renders from ────────────────────────────────


def test_the_catalogue_offers_only_resources_the_engine_can_select_from(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = client.get(CATALOG, headers=headers).get_json()

    from src.services.explorer import resources

    assert {item["key"] for item in answer["resources"]} <= set(resources())
    assert answer["resources"], "the editor cannot offer nothing"


def test_the_catalogue_declares_what_each_action_needs(client, monkeypatch):
    """The form asks for exactly what the executor reads (§76)."""
    headers = _authenticate(monkeypatch)
    answer = client.get(CATALOG, headers=headers).get_json()
    needs = {item["kind"]: item["needs"] for item in answer["actions"]}

    assert needs["NOTIFY"] == ["recipients"]
    assert needs["WEBHOOK"] == ["url"]
    # A task needs nothing beyond the rule itself — it has a title to fall
    # back on and the queue takes it unassigned.
    assert needs["TASK"] == []


# ── Validation, at the point somebody can still fix it ───────────────────


def test_an_automation_with_no_action_is_refused(client, monkeypatch):
    """It would match, record fires and do nothing — the worst state."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Does nothing", "resource_type": "task",
              "condition_tree": _condition(), "actions": []},
        headers=headers,
    )
    assert response.status_code == 400
    assert "at least one action" in response.get_json()["message"]


def test_an_unknown_action_is_named_rather_than_ignored(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Sends a pigeon", "resource_type": "task",
              "condition_tree": _condition(), "actions": [{"kind": "PIGEON"}]},
        headers=headers,
    )
    assert response.status_code == 400
    body = response.get_json()
    assert "PIGEON" in body["message"]
    assert "NOTIFY" in body["details"]["allowed"]


def test_an_action_that_reaches_nobody_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Tells nobody", "resource_type": "task",
              "condition_tree": _condition(),
              "actions": [{"kind": "NOTIFY", "recipients": {}}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "who it reaches" in response.get_json()["message"]


def test_a_webhook_target_is_checked_when_the_rule_is_saved(client, monkeypatch):
    """Not when it fires. A rule cannot sit in the table carrying a target the
    engine would refuse."""
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Calls a file", "resource_type": "task",
              "condition_tree": _condition(),
              "actions": [{"kind": "WEBHOOK", "url": "file:///etc/passwd"}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "http" in response.get_json()["message"]


def test_a_condition_naming_a_field_that_is_not_there_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Watches nothing", "resource_type": "task",
              "condition_tree": _condition("unicorn_count", ("7",)),
              "actions": [{"kind": "TASK"}]},
        headers=headers,
    )
    assert response.status_code == 400
    assert "unicorn_count" in response.get_json()["message"]


def test_a_schedule_is_five_cron_fields(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = client.post(
        RULES,
        json={"name": "Runs on Tuesdays sometime", "resource_type": "task",
              "condition_tree": _condition(), "actions": [{"kind": "TASK"}],
              "schedule": "every fifteen minutes"},
        headers=headers,
    )
    assert response.status_code == 400
    assert "five cron fields" in response.get_json()["message"]


# ── The stored text is the compiled condition ────────────────────────────


def test_the_stored_text_is_rendered_by_the_same_module_that_compiles_it(
    client, monkeypatch
):
    """The whole point of an inspector is that it cannot drift (§51)."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, condition_tree=_condition("status", ("NEW", "BLOCKED")))

    from src.core.rules import describe_tree
    from src.services.explorer import resources

    expected = describe_tree(rule["condition_tree"], resources()["task"].fields)
    assert rule["condition_text"] == expected
    assert "Status" in rule["condition_text"]


def test_a_rule_with_no_condition_matches_nothing(client, monkeypatch):
    """Reading "no conditions" as "everything" is the reading that sends the
    forty messages."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, condition_tree=None)
    assert _run(client, headers, rule["id"])["matched"] == 0


# ── Dry run ──────────────────────────────────────────────────────────────


def test_a_dry_run_reports_what_would_happen_and_changes_nothing(
    client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers)

    from src.models.platform import AlertRuleFire

    with session_scope() as session:
        before = len(session.scalars(_mine(rule["id"])).all())

    answer = _run(client, headers, rule["id"], dry_run=True)

    assert answer["dry_run"] is True
    assert answer["matched"] > 0, "the seed has tasks in NEW"
    # Everything matched is either acted on or deferred — never dropped.
    # Asserting `fired == matched` was only true while the table was smaller
    # than one run's fire budget, which is a test that passes for a reason
    # that has nothing to do with the claim.
    assert answer["fired"] + answer["deferred"] == answer["matched"]
    assert answer["fired"] == min(answer["matched"], service.MAX_FIRES)
    assert {item["state"] for item in answer["sample"]} == {"WOULD FIRE"}

    with session_scope() as session:
        # No cooldown started, so the real run that follows is not suppressed
        # by the rehearsal — the single most confusing thing a dry run could do.
        assert session.scalars(
            select(AlertRuleFire).where(AlertRuleFire.rule_id == rule["id"])
        ).first() is None
        assert len(session.scalars(_mine(rule["id"])).all()) == before == 0


def test_a_paused_rule_may_be_rehearsed_but_not_fired(client, monkeypatch):
    """Reading what it *would* do is how somebody decides to enable it."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, enabled=False)

    assert _run(client, headers, rule["id"], dry_run=True)["matched"] >= 0

    response = client.post(
        f"{RULES}/{rule['id']}/run", json={"dry_run": False}, headers=headers
    )
    assert response.status_code == 400
    assert "paused" in response.get_json()["message"]


def test_the_dry_run_and_the_real_run_agree_on_the_matches(client, monkeypatch):
    """One evaluator, or the preview can disagree with the thing it previews."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=0)

    rehearsal = _run(client, headers, rule["id"], dry_run=True)
    real = _run(client, headers, rule["id"], dry_run=False)
    assert real["matched"] == rehearsal["matched"]
    assert real["fired"] == rehearsal["fired"]


# ── Firing, and the cooldown ─────────────────────────────────────────────


def test_firing_notifies_and_records_the_run(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers)

    answer = _run(client, headers, rule["id"], dry_run=False)
    assert answer["fired"] > 0
    assert {item["state"] for item in answer["sample"]} == {"FIRED"}
    assert answer["by_action"]["NOTIFY"]["ok"] > 0

    with session_scope() as session:
        written = session.scalars(_mine(rule["id"])).all()
    assert written, "the notify action wrote nothing"
    # The notification is actionable: it says where the record is (§66).
    assert all(item.link and item.link.startswith("/tasks/") for item in written)


def test_the_cooldown_is_held_per_record_and_not_per_rule(client, monkeypatch):
    """The difference between the requirement and a thing that looks like it.

    A rule cooling down as a whole would act on forty breached records in one
    run and then go quiet about the forty-first. Held per record, a second run
    suppresses *every* record it already acted on — and the count says so
    rather than the run silently reporting nothing.
    """
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=60)

    first = _run(client, headers, rule["id"], dry_run=False)
    assert first["fired"] > 1, "this test needs more than one match to mean anything"

    second = _run(client, headers, rule["id"], dry_run=False)
    assert second["matched"] == first["matched"]

    # Every record the first run acted on is now held back — that is the
    # requirement, stated as the count. Asserting `second["fired"] == 0`
    # instead would only hold while the whole match set fitted inside one
    # run's fire budget, and would start failing as the table grew for a
    # reason that has nothing to do with the cooldown.
    assert second["suppressed"] == first["fired"]

    # And nothing was acted on twice: the records the second run fired on are
    # different records, which is the same claim from the other side.
    acted = {item["record_id"] for item in first["sample"] if item["state"] == "FIRED"}
    again = {item["record_id"] for item in second["sample"] if item["state"] == "FIRED"}
    assert acted and not (acted & again)


def test_a_zero_cooldown_fires_every_time(client, monkeypatch):
    """A cooldown is a choice, and "no cooldown" has to mean no cooldown."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=0)

    first = _run(client, headers, rule["id"], dry_run=False)
    second = _run(client, headers, rule["id"], dry_run=False)
    assert second["fired"] == first["fired"]
    assert second["suppressed"] == 0


def test_the_rule_says_which_records_it_is_holding_back_and_until_when(
    client, monkeypatch
):
    """The answer to "why has it gone quiet", derived rather than stored."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=120)
    _run(client, headers, rule["id"], dry_run=False)

    detail = client.get(f"{RULES}/{rule['id']}", headers=headers).get_json()
    assert detail["cooling_down"], "it just fired on several records"
    entry = detail["cooling_down"][0]
    assert entry["record"] and entry["until"] > entry["last_fired_at"]


def test_shortening_the_cooldown_takes_effect_immediately(client, monkeypatch):
    """Which is why the expiry is derived at read time and never stored."""
    headers = _authenticate(monkeypatch)
    rule = _rule(client, headers, cooldown_minutes=600)
    _run(client, headers, rule["id"], dry_run=False)
    assert client.get(f"{RULES}/{rule['id']}", headers=headers).get_json()["cooling_down"]

    client.put(f"{RULES}/{rule['id']}", json={"cooldown_minutes": 0}, headers=headers)
    detail = client.get(f"{RULES}/{rule['id']}", headers=headers).get_json()
    assert detail["cooling_down"] == []


# ── Actions ──────────────────────────────────────────────────────────────


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


# ── Ownership and history ────────────────────────────────────────────────


def test_only_the_author_changes_an_automation(client, monkeypatch):
    """It reaches other people's inboxes, so "anybody who may write one may
    rewrite yours" is the wrong default."""
    headers = _authenticate(monkeypatch, "manager", "manager")
    rule = _rule(client, headers)

    # A second person who holds the permission, and is not an administrator.
    monkeypatch.setattr(
        "src.core.auth.verify_token",
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

    from src.models.platform import AlertRule

    with session_scope() as session:
        row = session.get(AlertRule, rule["id"])
        row.condition_tree = _condition("field_that_went_away", ("x",))

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
