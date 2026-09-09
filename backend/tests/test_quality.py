"""Data quality (§65).

The property that makes this page worth having is that **a count and its link
are the same question**. Every check is declared as the filters a reader could
type in the URL, so the number and the rows come from one statement — and this
suite asserts that by running the check's own count and then running the
*list's* query with the check's filters and comparing.

Everything else follows from it: the checks a filter cannot express are counted
in SQL and publish a sample instead, and the page is told which is which.
"""

from __future__ import annotations

import pytest

from src.config import Config
from src.core.query import apply_filters, count_of
from src.core.vocabulary import QUALITY_SEVERITY
from src.services import quality
from src.services.explorer import _base_statement, resource_for
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX
QUALITY = f"{PREFIX}/admin/quality"


def _authenticate(monkeypatch, username: str = "admin", role: str = "administrator"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"quality-{username}"),
    )
    return {"Authorization": f"Bearer quality-{username}"}


# ── the catalogue ────────────────────────────────────────────────────────


def test_every_check_says_what_is_wrong_why_and_what_to_do():
    """A finding with no remedy is a complaint.

    Asserted over the whole catalogue rather than one example, because the
    failure mode is a check added later with a title and nothing else — which
    is a page that tells somebody there is a problem and leaves them there.
    """
    for check in quality.catalogue():
        assert check.title, check.key
        assert len(check.why) > 40, check.key
        assert len(check.fix) > 10, check.key
        assert check.severity in QUALITY_SEVERITY, check.key


def test_every_check_names_a_dataset_that_exists():
    # A check against a dataset nobody publishes is a check nothing can run,
    # and it would be counted as passing.
    keys = {check.resource for check in quality.catalogue()}
    for key in keys:
        assert resource_for(key) is not None


def test_no_two_checks_share_a_key():
    keys = [check.key for check in quality.catalogue()]
    # The key is the anchor the page renders and a link addresses; two checks
    # sharing one would make the second unreachable.
    assert len(set(keys)) == len(keys)


def test_a_check_is_either_a_filter_or_a_predicate_and_never_both():
    """The distinction the page draws.

    A check with both would be counted one way and linked another, which is the
    exact disagreement this design exists to prevent.
    """
    for check in quality.catalogue():
        if check.predicate is not None:
            assert check.filters == {}, check.key
        else:
            assert check.filters, check.key


def test_every_severity_is_used_by_something():
    # A grade nothing ever carries is a grade the page renders untested, and a
    # legend with an entry nobody sees.
    used = {check.severity for check in quality.catalogue()}
    assert used == set(QUALITY_SEVERITY)


def test_a_contradiction_is_graded_critical():
    """CRITICAL is reserved for a state that cannot be true.

    Not for "a lot of rows": one order shipped and never paid matters more than
    four hundred missing phone numbers, and grading by volume would bury it.
    """
    by_key = {check.key: check for check in quality.catalogue()}
    assert by_key["order_shipped_unpaid"].severity == "CRITICAL"
    assert by_key["ticket_resolved_without_moment"].severity == "CRITICAL"
    # And a gap is not: nobody has done anything impossible by leaving a
    # customer unassigned.
    assert by_key["customer_no_manager"].severity == "WARNING"


# ── the endpoint ─────────────────────────────────────────────────────────


def test_the_checks_need_a_bearer_token(client):
    assert client.get(QUALITY).status_code == 401
    assert client.get(f"{QUALITY}/ticket").status_code == 401


@pytest.mark.database
def test_reading_a_list_is_enough_to_be_told_it_contradicts_itself(client, monkeypatch):
    # `records.view` and nothing narrower: what this returns is a count of rows
    # the reader can already see. A separate permission would let an
    # installation grant somebody a list and withhold the news about it.
    _authenticate(monkeypatch, "user", "viewer")
    response = client.get(QUALITY, headers={"Authorization": "Bearer quality-user"})
    assert response.status_code == 200
    assert response.get_json()["totals"]["checks"] == len(quality.catalogue())


@pytest.mark.database
def test_a_dataset_nobody_publishes_is_refused_by_name(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    # A refusal rather than an empty page, which looks exactly like a clean
    # bill of health for a dataset that does not exist. 400 and not 404,
    # because the answer names the datasets that *do* exist and the caller has
    # usually mistyped one of them.
    for url in (f"{QUALITY}?resource_type=nonesuch", f"{QUALITY}/nonesuch"):
        response = client.get(url, headers=headers)
        assert response.status_code == 400, url
        assert "available" in response.get_json()["details"], url


@pytest.mark.database
def test_the_page_reports_the_checks_that_passed_as_well(client, monkeypatch):
    """A page listing only problems cannot be told from one whose checks broke."""
    body = client.get(QUALITY, headers=_authenticate(monkeypatch)).get_json()

    assert len(body["findings"]) == len(quality.catalogue())
    assert body["totals"]["checks"] == len(body["findings"])
    assert body["totals"]["failing"] == sum(
        1 for finding in body["findings"] if finding["count"] > 0
    )
    # The seeded dataset really does contain problems, so this suite is
    # asserting against something rather than against an empty database.
    assert body["totals"]["failing"] > 0


@pytest.mark.database
def test_a_count_and_its_link_are_the_same_question(client, monkeypatch):
    """The property the whole design rests on.

    Each filterable check is counted through `apply_filters` and *linked*
    through the same filters, so the number on the page and the rows the link
    opens come from one statement. This runs the list's own query with the
    check's filters and compares — a check counted one way and linked another
    would disagree here rather than on somebody's screen.
    """
    from src.core.db import session_scope

    body = client.get(QUALITY, headers=_authenticate(monkeypatch)).get_json()
    findings = {finding["key"]: finding for finding in body["findings"]}

    with session_scope() as session:
        for check in quality.catalogue():
            if not check.linkable:
                continue
            resource = resource_for(check.resource)
            listed = count_of(
                session,
                apply_filters(_base_statement(resource), dict(check.filters), resource.fields),
            )
            assert findings[check.key]["count"] == listed, check.key
            # And the link is those filters, `f.`-prefixed the way the entity
            # pages carry them.
            for name, value in check.filters.items():
                # Comparable at all because the relative moments are rounded to
                # the day: a link carrying microseconds is an address that
                # means something different every time the page is opened, and
                # two calls a millisecond apart produced two different ones.
                assert f"f.{name}={value}" in findings[check.key]["link"], check.key


@pytest.mark.database
def test_a_check_a_filter_cannot_express_names_records_instead(client, monkeypatch):
    body = client.get(QUALITY, headers=_authenticate(monkeypatch)).get_json()
    overspent = next(
        finding for finding in body["findings"] if finding["key"] == "project_overspent"
    )

    # No link, because `spent > budget` compares two columns and the filter
    # vocabulary compares a column to a value. A link would open the wrong rows.
    assert overspent["link"] == ""
    assert "two columns" in overspent["why_no_link"]
    if overspent["count"]:
        assert overspent["sample"]
        assert len(overspent["sample"]) <= quality.SAMPLE
        # Each named record opens on its own page, so the finding is actionable
        # without a list.
        for entry in overspent["sample"]:
            assert entry["path"].startswith("/projects/")


@pytest.mark.database
def test_a_deleted_record_is_not_a_data_quality_problem(client, monkeypatch):
    """The soft-delete rule is the list's, not a second one.

    A quality report counting deleted rows would report problems nobody can
    open — and this suite creates and deletes records, so it would grow its own
    findings run after run.
    """
    from src.core.db import session_scope
    from src.models.business import Ticket
    from src.models.platform import ActivityEntry, AuditLog

    headers = _authenticate(monkeypatch)

    def unassigned() -> int:
        body = client.get(f"{QUALITY}?resource_type=ticket", headers=headers).get_json()
        return next(
            finding["count"]
            for finding in body["findings"]
            if finding["key"] == "ticket_unassigned_open"
        )

    before = unassigned()
    created = client.post(
        f"{PREFIX}/api/records/ticket",
        json={
            "subject": "Quality probe", "description": "Created by the quality test.",
            "status": "OPEN", "priority": "NORMAL", "severity": "MINOR",
            "category": "SUPPORT", "channel": "EMAIL",
        },
        headers=headers,
    )
    assert created.status_code == 201, created.get_json()
    ticket_id = created.get_json()["id"]

    try:
        # It has no assignee, so it is a finding while it exists.
        assert unassigned() == before + 1
        assert client.delete(
            f"{PREFIX}/api/records/ticket/{ticket_id}", headers=headers
        ).status_code == 200
        assert unassigned() == before
    finally:
        with session_scope() as session:
            session.query(ActivityEntry).filter(
                ActivityEntry.resource_id == ticket_id
            ).delete(synchronize_session=False)
            session.query(AuditLog).filter(AuditLog.resource_id == ticket_id).delete(
                synchronize_session=False
            )
            session.query(Ticket).filter(Ticket.id == ticket_id).delete(
                synchronize_session=False
            )


@pytest.mark.database
def test_one_dataset_can_be_asked_on_its_own(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = client.get(f"{QUALITY}?resource_type=order", headers=headers).get_json()

    assert {finding["resource_type"] for finding in body["findings"]} == {"order"}
    # The summary the list's own indicator reads agrees with the page.
    summary = client.get(f"{QUALITY}/order", headers=headers).get_json()
    assert summary["failing"] == body["totals"]["failing"]
    assert summary["records"] == body["totals"]["records"]


@pytest.mark.database
def test_the_indicator_names_the_worst_thing_found(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    summary = client.get(f"{QUALITY}/order", headers=headers).get_json()

    # One colour rather than three, and it is the worst — a chip that showed
    # the commonest grade would say "info" over a contradiction.
    if summary["by_severity"]["CRITICAL"]:
        assert summary["worst"] == "CRITICAL"
    elif summary["by_severity"]["WARNING"]:
        assert summary["worst"] == "WARNING"
    elif summary["by_severity"]["INFO"]:
        assert summary["worst"] == "INFO"
    else:
        assert summary["worst"] == ""
