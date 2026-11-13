"""The seed, checked without a database. — determinism."""

from __future__ import annotations

from src.seed import runner
from src.seed.identity import PERSONA_DOMAIN, PERSONAS
from src.seed.world import SMALL
from tests.seed_support import (  # noqa: F401
    SEED,
    scratch_database,
    world,
)


def test_the_same_seed_produces_the_same_graph():
    """Stable ids are the point: a screenshot, a bookmark or a URL in a ticket
    only survives a reseed if the ids do."""
    first = runner.generate(scale=SMALL, seed=SEED)
    second = runner.generate(scale=SMALL, seed=SEED)

    assert [u.id for u in first.users] == [u.id for u in second.users]
    assert [u.email for u in first.users] == [u.email for u in second.users]
    assert [p.code for p in first.projects] == [p.code for p in second.projects]
    assert [t.reference for t in first.tasks] == [t.reference for t in second.tasks]


def test_a_different_seed_produces_a_different_graph():
    other = runner.generate(scale=SMALL, seed=SEED + 1)
    baseline = runner.generate(scale=SMALL, seed=SEED)
    assert [u.id for u in other.users] != [u.id for u in baseline.users]


def test_timestamps_are_relative_to_the_run(world):
    """Dates are offsets from an anchor taken at generation time, so a dataset
    seeded today looks like it was made today."""
    assert all(user.created_at <= world.anchor for user in world.users)
    recent = [log for log in world.system_logs if log.logged_at > world.anchor.replace(year=world.anchor.year - 1)]
    assert recent, "system logs should sit in the recent past, not a fixed year"


def test_realm_personas_exist_with_the_keycloak_emails(world):
    """`core/auth.py` matches a token to a profile by subject, then by email.
    If these drift from the realm export, signing in provisions an empty
    profile beside the seeded one instead of adopting it."""
    emails = {user.email for user in world.users}
    for username, *_rest in PERSONAS:
        assert f"{username}@{PERSONA_DOMAIN}" in emails


def test_personas_carry_every_role(world):
    assert set(world.personas) == {
        "ADMINISTRATOR", "MANAGER", "OPERATOR", "ANALYST", "VIEWER",
    }


def test_personas_share_one_organization(world):
    """They live together so the org a reviewer opens is the populated one."""
    orgs = {persona.organization_id for persona in world.personas.values()}
    assert len(orgs) == 1


def test_personas_own_personal_data(world):
    """An empty dashboard on the account everyone signs in as looks like a bug."""
    persona_ids = {persona.id for persona in world.personas.values()}
    assert any(d.owner_id in persona_ids for d in world.dashboards)
    assert any(s.owner_id in persona_ids for s in world.saved_searches)
    assert any(f.user_id in persona_ids for f in world.favorites)
    assert any(n.user_id in persona_ids for n in world.notifications)


def test_every_reference_points_at_something_built(world):
    users = {u.id for u in world.users}
    projects = {p.id for p in world.projects}
    organizations = {o.id for o in world.organizations}
    dashboards = {d.id for d in world.dashboards}
    threads = {t.id for t in world.email_threads}

    for task in world.tasks:
        assert task.project_id in projects
        assert task.assignee_id is None or task.assignee_id in users
    for project in world.projects:
        assert project.organization_id in organizations
        assert project.owner_id is None or project.owner_id in users
    for widget in world.dashboard_widgets:
        assert widget.dashboard_id in dashboards
    for message in world.email_messages:
        assert message.thread_id in threads
    for entry in world.audit_logs:
        assert entry.actor_id in users


def test_self_references_point_backwards(world):
    """Parents are emitted before children, which is what lets the rows insert
    without deferring the constraint."""
    for collection, key in (
        (world.tasks, "parent_id"),
        (world.comments, "parent_id"),
        (world.folders, "parent_id"),
        (world.departments, "parent_id"),
        (world.email_messages, "in_reply_to"),
    ):
        seen: set = set()
        for row in collection:
            parent = getattr(row, key)
            assert parent is None or parent in seen, f"{key} points forward"
            seen.add(row.id)


def test_nobody_manages_themselves(world):
    assert all(user.manager_id != user.id for user in world.users)


def test_denormalised_task_counts_are_true(world):
    actual: dict = {}
    for task in world.tasks:
        actual[task.project_id] = actual.get(task.project_id, 0) + 1
    for project in world.projects:
        assert project.task_count == actual.get(project.id, 0)


def test_unique_constraints_are_respected(world):
    for collection, key in (
        (world.users, "email"),
        (world.users, "username"),
        (world.projects, "code"),
        (world.tasks, "reference"),
        (world.customers, "code"),
        (world.orders, "reference"),
        (world.organizations, "slug"),
        (world.email_messages, "message_ref"),
    ):
        values = [getattr(row, key) for row in collection]
        assert len(values) == len(set(values)), f"duplicate {key}"

    composite = [(f.user_id, f.resource_type, f.resource_id) for f in world.favorites]
    assert len(composite) == len(set(composite))
    links = [(t.tag_id, t.resource_type, t.resource_id) for t in world.tag_links]
    assert len(links) == len(set(links))


def test_statuses_are_spread_not_uniform(world):
    """Weighted draws are what make a board look like a real backlog rather
    than a bar chart of equal columns."""
    counts: dict = {}
    for task in world.tasks:
        counts[task.status] = counts.get(task.status, 0) + 1
    assert len(counts) >= 5
    assert max(counts.values()) > min(counts.values()) * 1.5


def test_some_values_are_deliberately_missing(world):
    """Empty states, "—" placeholders and the `is empty` filter need something
    genuinely absent to act on."""
    assert any(c.satisfaction is None for c in world.customers)
    assert any(c.satisfaction is not None for c in world.customers)
    assert any(t.assignee_id is None for t in world.tasks)


def test_audit_entries_carry_a_readable_diff(world):
    """§21 is only useful if the drawer can show what actually changed."""
    with_changes = [entry for entry in world.audit_logs if entry.changes]
    assert with_changes
    entry = with_changes[0]
    assert entry.changed_fields
    for field, change in entry.changes.items():
        assert set(change) == {"from", "to"}
        assert field in entry.changed_fields


def test_audit_entries_identify_who_and_when(world):
    for entry in world.audit_logs:
        assert entry.actor_id and entry.actor_label and entry.actor_role
        assert entry.occurred_at is not None
        assert entry.resource_type and entry.resource_id


def test_offline_devices_have_not_just_reported(world):
    """A device that is offline but was seen thirty seconds ago is a
    contradiction the monitoring screens would render as one."""
    offline = [d for d in world.devices if d.status == "OFFLINE"]
    for device in offline:
        assert (world.anchor - device.last_seen_at).total_seconds() > 3600


def test_every_seeded_report_can_actually_be_run(world):
    """A saved report the compiler rejects is a row that fails on being opened.

    This is the test that should have existed. The generator drew its
    dimensions from a literal ``("region", "status", "owner", "month", …)`` and
    its measures from ``("count", "total", "average", "median", "sum")``; no
    dataset declares `region`, `owner` or `month`, and `total`, `average` and
    `median` are not aggregations. So every seeded report named something that
    does not exist, and `/reports` opened on "region cannot be grouped by" —
    found by a screenshot, not by the suite.

    Asserted against the same declarations the compiler resolves against, so
    the test cannot drift from the rule it is checking.
    """
    from src.services.analytics.analysis import (
        AGGREGATIONS,
        DIMENSION_KINDS,
        MEASURE_KINDS,
    )
    from src.services.records.explorer import resources

    catalogue = resources()
    assert world.reports, "the seed builds no reports at all"

    for report in world.reports:
        resource = catalogue.get(report.resource_type)
        assert resource is not None, f"{report.name} reports on {report.resource_type}"

        groupable = {
            field.name
            for field in resource.fields.fields
            if field.kind in DIMENSION_KINDS and field.filterable
        }
        measurable = {
            field.name for field in resource.fields.fields if field.kind in MEASURE_KINDS
        }

        # At most two: the compiler refuses a third outright.
        assert len(report.dimensions) <= 2, f"{report.name} groups by {report.dimensions}"
        for entry in report.dimensions:
            name = str(entry).partition(":")[0]
            assert name in groupable, f"{report.name} cannot group {report.resource_type} by {name}"

        for entry in report.metrics:
            aggregation, _, field = str(entry).partition(":")
            assert aggregation in AGGREGATIONS, f"{report.name} uses {aggregation}"
            if aggregation != "count":
                assert field in measurable, f"{report.name} cannot {aggregation} {field!r}"

        # `group_by` is a fourth opinion about the same question unless it is
        # one of the dimensions.
        assert report.group_by in {str(d).partition(":")[0] for d in report.dimensions}


def test_the_dataset_check_names_an_unrunnable_report():
    """`--check` has to *find* the defect above, not merely be right about it.

    A check nobody can trust is a check nobody runs, so the branch is exercised
    on a report built to be broken rather than only on a good dataset — where
    it would pass whether or not it looked.
    """
    from src.models.personal import Report

    broken = Report(
        name="Revenue by region",
        resource_type="order",
        dimensions=["region", "status", "channel"],
        metrics=["median"],
        group_by="region",
    )

    class _Session:
        """Just enough of a session for the check: it only scalars one query."""

        def scalars(self, _statement):
            return [broken]

    problems = runner._unrunnable_reports(_Session())
    joined = " | ".join(problems)
    assert "cannot group order by region" in joined
    assert "median is not an aggregation" in joined
    assert "more than two columns" in joined


def test_every_announcement_state_is_demonstrable(world):
    """A demo where a state cannot be seen is a demo of an untested filter.

    Left to the weights alone, the small-scale dataset produced no expired
    notice and no draft — so the author's list could not show a draft and the
    reader's list could not show that an expired one is hidden. The first four
    are now fixed, and this is what says so.
    """
    statuses = {item.status for item in world.announcements}
    assert {"PUBLISHED", "SCHEDULED", "DRAFT"} <= statuses

    # And one that is published but past its window, which is the state the
    # service *derives* rather than stores.
    expired = [
        item
        for item in world.announcements
        if item.status == "PUBLISHED" and item.expires_at and item.expires_at <= world.anchor
    ]
    assert expired, "no announcement has run out, so expiry is undemonstrable"


def test_exactly_one_announcement_is_pinned(world):
    """A list where everything is pinned has nothing pinned."""
    pinned = [item for item in world.announcements if item.is_pinned]
    assert len(pinned) == 1
    assert pinned[0].status == "PUBLISHED"
    assert pinned[0].expires_at is None or pinned[0].expires_at > world.anchor


def test_announcement_receipts_belong_to_people_it_was_addressed_to(world):
    """A receipt from somebody outside the audience is a row that says a notice
    reached a reader it was never shown to."""
    by_id = {item.id: item for item in world.announcements}
    roles = {user.id: user.role_id for user in world.users}
    role_codes = {role.id: role.code for role in world.roles}

    assert world.announcement_receipts, "nobody has read anything"
    for receipt in world.announcement_receipts:
        notice = by_id[receipt.announcement_id]
        assert notice.status == "PUBLISHED", "a receipt against an unpublished notice"
        audience = list(notice.audience_roles or [])
        if audience:
            assert role_codes.get(roles.get(receipt.user_id)) in audience
        # Read before acknowledged, always: agreeing to something unread is
        # not a state the product can produce.
        assert receipt.read_at is not None
        if receipt.acknowledged_at is not None:
            assert notice.requires_acknowledgement
            assert receipt.acknowledged_at >= receipt.read_at


def test_announcement_receipts_are_unique_per_reader(world):
    keys = [(r.announcement_id, r.user_id) for r in world.announcement_receipts]
    assert len(keys) == len(set(keys))
