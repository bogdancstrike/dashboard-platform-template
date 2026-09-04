"""The seed, checked without a database.

`generate()` builds the whole graph in memory, so the interesting properties —
referential consistency, determinism, the volume targets, the personas — can all
be asserted from a plain function call. The tests that need PostgreSQL are
marked `database` and skip unless `TEST_DATABASE_URL` is set.
"""

from __future__ import annotations

import os

import pytest

from src.seed import runner
from src.seed.identity import PERSONA_DOMAIN, PERSONAS
from src.seed.world import FULL, SMALL

SEED = 20260101


@pytest.fixture(scope="module")
def world():
    return runner.generate(scale=SMALL, seed=SEED)


# ── determinism ──────────────────────────────────────────────────────────


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


# ── the personas ─────────────────────────────────────────────────────────


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


# ── referential consistency ──────────────────────────────────────────────


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


# ── the data is worth looking at ─────────────────────────────────────────


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


def test_saved_searches_are_private_by_default(world):
    """§5: nothing is shared by accident, so most searches have no audience."""
    scopes = [search.scope for search in world.saved_searches]
    assert set(scopes) <= {"PRIVATE", "SHARED", "PUBLIC"}
    assert scopes.count("PRIVATE") > scopes.count("PUBLIC")


def test_only_shared_searches_have_members(world):
    """A share row on a private search is dead data the visibility query would
    then have to remember to ignore."""
    by_id = {str(search.id): search for search in world.saved_searches}
    for share in world.resource_shares:
        assert share.resource_type == "saved_search"
        owner_search = by_id[share.resource_id]
        assert owner_search.scope == "SHARED"


def test_a_share_never_grants_edit(world):
    """Editing and deleting belong to the owner alone (§5)."""
    assert all(share.permission == "VIEW" for share in world.resource_shares)


def test_nobody_is_a_member_of_their_own_search(world):
    by_id = {str(search.id): search for search in world.saved_searches}
    for share in world.resource_shares:
        assert share.user_id != by_id[share.resource_id].owner_id


def test_shares_are_unique_per_person_and_resource(world):
    keys = [(s.resource_type, s.resource_id, s.user_id) for s in world.resource_shares]
    assert len(keys) == len(set(keys))


def test_credentials_never_store_plaintext(world):
    for credential in world.api_credentials:
        assert credential.secret_hash.startswith("sha256$")
        assert len(credential.prefix) <= 12


def test_full_scale_meets_the_documented_volumes():
    """The numbers in docs/TODO.md, asserted rather than assumed."""
    world = runner.generate(scale=FULL, seed=SEED)
    counts = world.counts()
    for table, minimum in (
        ("organizations", 20), ("users", 150), ("projects", 50), ("tasks", 500),
        ("audit_logs", 1000), ("email_messages", 200), ("files", 100),
        ("background_jobs", 100), ("customers", 300), ("orders", 800),
    ):
        assert counts[table] >= minimum, f"{table}: {counts[table]} < {minimum}"
    assert world.total() > 10_000


# ── against a real database ──────────────────────────────────────────────


@pytest.fixture()
def scratch_database(has_database):
    """A database of this test's own, created on demand and left behind empty.

    This is the one test that drops every table, and `make test-backend-db`
    points `TEST_DATABASE_URL` at the *running stack's* database — so pointed
    at `platform` it would quietly replace the demo dataset with a small one,
    and every Playwright run afterwards would measure something other than what
    `docker compose up` produced. That failure is silent, which is what makes
    it worth a fixture: the suite passes, the seed is verified, and the data
    everything else was checked against is gone.

    So the destructive work happens in `<database>_scratch`, and the engine the
    seed runner uses is swapped for its duration.
    """
    url = os.getenv("TEST_DATABASE_URL")
    if not url:  # pragma: no cover - guarded by the `database` marker
        pytest.skip("set TEST_DATABASE_URL to run tests that need PostgreSQL")

    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    target = make_url(url)
    scratch_name = f"{target.database}_scratch"
    scratch = target.set(database=scratch_name)

    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as connection:
            exists = connection.scalar(
                text("select 1 from pg_database where datname = :name"), {"name": scratch_name}
            )
            if not exists:
                # The name is derived from a URL the developer supplied, not
                # from a request, and quoting it keeps a database called
                # "platform-test" from becoming a syntax error.
                connection.execute(text(f'create database "{scratch_name}"'))
    except Exception as exc:  # pragma: no cover - no permission to create one
        pytest.skip(f"cannot create a scratch database ({exc.__class__.__name__})")
    finally:
        admin.dispose()

    from src.core import db as db_module

    previous_engine, previous_maker = db_module._engine, db_module._SessionLocal
    db_module._engine = create_engine(scratch, future=True)
    db_module._SessionLocal = None
    try:
        yield db_module._engine
    finally:
        db_module._engine.dispose()
        db_module._engine, db_module._SessionLocal = previous_engine, previous_maker


@pytest.mark.database
def test_seed_writes_and_verifies(scratch_database):
    from src.core.db import session_scope

    runner.drop_schema(scratch_database)
    runner.bootstrap_schema(scratch_database)
    with session_scope() as session:
        runner.run(session, scale="small", seed=SEED)
        assert runner.verify(session) == []
