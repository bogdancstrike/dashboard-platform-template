"""`--check` names every inconsistency it claims to, and each `--sync-*` mends it.

`test_seed` proves a fresh seed verifies and `test_seed_cli` that every repair
is idempotent on a healthy database. Neither ever shows `verify` *finding*
anything, or a repair having something to do — which is the whole reason both
exist: they were written for databases that had drifted (an export claiming a
file nobody wrote, a draft import with nothing staged, three sessions each
"current"). So here each drift is made on purpose and the check, then the
repair, is asked about it.

Everything happens in a per-process `<database>_scratch_<pid>`, inside a transaction that is
rolled back — the demo database is never touched.
"""

from __future__ import annotations

import os
import uuid

import pytest

pytestmark = pytest.mark.database


@pytest.fixture(scope="module")
def scratch(has_database, tmp_path_factory):
    """A small seeded world in the scratch database, shared by this module."""
    if not has_database:
        pytest.skip("set TEST_DATABASE_URL to run tests that need PostgreSQL")
    from sqlalchemy import create_engine, text
    from sqlalchemy.engine import make_url

    from src.core import db as db_module
    from src.seed import runner

    target = make_url(os.environ["TEST_DATABASE_URL"])
    name = f"{target.database}_scratch_{os.getpid()}"
    admin = create_engine(target.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        if not connection.scalar(text("select 1 from pg_database where datname = :n"), {"n": name}):
            connection.execute(text(f'create database "{name}"'))
    admin.dispose()

    previous = db_module._engine, db_module._SessionLocal
    db_module._engine = create_engine(target.set(database=name), future=True)
    db_module._SessionLocal = None
    try:
        runner.drop_schema(db_module._engine)
        runner.bootstrap_schema(db_module._engine)
        from src.core.storage import LocalStorage
        from src.seed import blobs
        from src.seed import exports as export_files

        store = LocalStorage(str(tmp_path_factory.mktemp("objects")), secret="test", prefix="/files")
        with db_module.session_scope() as session:
            runner.run(session, scale="small", seed=29)
            blobs.materialise(session, store)
            export_files.materialise(session, store)
        yield db_module._engine
    finally:
        db_module._engine.dispose()
        db_module._engine, db_module._SessionLocal = previous
        from tests.test_seed import drop_scratch

        drop_scratch(target, name)


@pytest.fixture()
def session(scratch):
    """A session on the scratch world whose every change is rolled back."""
    from src.core.db import new_session

    s = new_session()
    try:
        yield s
    finally:
        s.rollback()
        s.close()


def _first(session, model, *where):
    from sqlalchemy import select

    return session.scalars(select(model).where(*where).limit(1)).first()


def _rows(session, model, n, *where):
    from sqlalchemy import select

    rows = session.scalars(select(model).where(*where).order_by(model.id).limit(n)).all()
    if len(rows) < n:
        pytest.skip(f"the small seed has fewer than {n} {model.__tablename__}")
    return rows


def test_a_fresh_seed_has_nothing_to_report(session):
    from src.seed import runner

    assert runner.verify(session) == []


def test_check_names_every_inconsistency_it_knows(session):
    from sqlalchemy import text

    from src.core import importer
    from src.core.clock import now
    from src.models.business import Project, Task
    from src.models.identity import Department, User, UserSession
    from src.models.personal import Dashboard, Report, ResourceShare, SavedSearch
    from src.models.platform import AlertRule, BackgroundJob, ImportRun
    from src.models.content import Tag
    from src.seed import runner

    # Orphans can only be made with the foreign keys out of the way.
    session.execute(text("SET LOCAL session_replication_role = replica"))
    task = _first(session, Task, Task.assignee_id.is_not(None))
    task.assignee_id = uuid.uuid4()
    task.tags = ["not-a-linked-tag"]

    e1, e2, e3, e4 = _rows(session, BackgroundJob, 4, BackgroundJob.kind == "EXPORT")
    e1.payload = {}
    e2.status, e2.result, e2.processed_units, e2.total_units = "SUCCEEDED", {}, 1, 2
    e3.status, e3.result, e3.processed_units, e3.total_units = "RUNNING", {"artifact": "x.csv"}, 5, 2
    e4.status, e4.failed_units = "FAILED", 0

    a, b, c, d = _rows(session, ImportRun, 4)
    a.target_entity = "nowhere"
    b.target_entity, b.detected_columns, b.column_mapping = "task", [], {"ghost": "no_such_field"}
    b.status, b.total_rows = "COMPLETED", importer.MAX_ROWS + 1
    b.valid_rows, b.invalid_rows, b.skipped_rows, b.imported_rows = 1, 0, 0, 5
    b.staged_rows, b.errors = [{"x": 1}], [{"message": "no line"}]
    c.target_entity, c.status, c.staged_rows = "task", "DRAFT", []
    d.target_entity, d.status, d.staged_rows, d.total_rows = "task", "VALIDATED", [{"x": 1}], 3
    d.valid_rows, d.invalid_rows, d.skipped_rows = 0, 1, 0
    d.errors = [{"line": 1, "message": "a"}, {"line": 2, "message": "b"}]

    person = _first(session, User, User.email == "admin@nucleus.example")
    from sqlalchemy import func, select

    someone = session.scalar(select(UserSession.user_id).where(UserSession.user_id.is_not(None))
                             .group_by(UserSession.user_id).having(func.count() > 1).limit(1))
    s1, s2 = _rows(session, UserSession, 2, UserSession.user_id == someone)
    s1.is_current = s2.is_current = True
    s2.revoked_at = now()
    person.manager_id = person.id
    person.email = "renamed@nucleus.example"

    report = _first(session, Report)
    report.is_favorite = True
    report.dimensions = ["status", "priority", "nowhere"]
    report.metrics = ["median:x", "sum:"]
    other = _rows(session, Report, 2)[1]
    other.resource_type = "nowhere"

    share = _first(session, ResourceShare)
    if share is not None:
        share.permission = "EDIT"
    search = _first(session, SavedSearch, SavedSearch.owner_id.is_not(None))
    session.add(ResourceShare(resource_type="saved_search", resource_id=str(search.id),
                              user_id=search.owner_id, permission="VIEW"))

    project = _first(session, Project)
    project.task_count = (project.task_count or 0) + 5
    _first(session, Dashboard).scope = "GALAXY"
    tag = _first(session, Tag)
    tag.usage_count = (tag.usage_count or 0) + 7
    _first(session, Department, Department.deleted_at.is_(None)).headcount = 999

    r1, r2, r3 = _rows(session, AlertRule, 3, AlertRule.enabled.is_(True), AlertRule.deleted_at.is_(None))
    r1.resource_type = "nowhere"
    r2.condition_tree = {"type": "group", "children1": {"a": {"type": "rule", "properties": {
        "field": "no_such_field", "operator": "equal", "value": ["x"]}}}}
    r3.actions = [{"kind": "TELEPORT"}]
    session.flush()

    problems = "\n".join(runner.verify(session))
    expected = [
        "tasks.assignee_id: 1 rows point at a missing parent",
        f"{e1.reference}: export names no dataset",
        f"{e2.reference}: a finished export with no file",
        f"{e2.reference}: finished without processing every unit",
        f"{e3.reference}: an unfinished export claiming a file",
        f"{e3.reference}: 5 of 2 units processed",
        f"{e4.reference}: a failed export that failed nothing",
        f"{a.reference}: imports into nowhere, which is not a dataset",
        f"{b.reference}: maps columns the file does not have: ['ghost']",
        f"{b.reference}: maps onto fields task does not accept: ['no_such_field']",
        f"past the {importer.MAX_ROWS} an import may carry",
        f"{b.reference}: imported 5 of 1 valid rows",
        f"{b.reference}: completed without importing every valid row",
        f"{b.reference}: has finished and still holds a copy of the file",
        f"{b.reference}: an error with no line number",
        f"{c.reference}: is open and holds no rows",
        f"{d.reference}: holds 1 rows and claims 3",
        f"{d.reference}: is validated with no valid row in it",
        f"{d.reference}: reports problems on 2 lines and counts 1 invalid",
        "sessions each claim to be the current one",
        "revoked session(s) still marked current",
        "reports: 1 row(s) still carry the old is_favorite flag",
        "rows share a search with its own owner",
        "users manage themselves",
        "projects.task_count: 1 projects disagree",
        "persona admin@nucleus.example is missing",
        "carry scope GALAXY",
        "task.tags: 1 records disagree with their tag links",
        "tags.usage_count: 1 tags disagree",
        "report(s) groups by more than two columns",
        "report(s) cannot group",
        "report(s) median is not an aggregation",
        "report(s) cannot sum",
        "report(s) names dataset nowhere, which does not exist",
        "automation(s) watch dataset nowhere, which does not exist",
        "automation(s) cannot compile their condition",
        "automation(s) carry no action this platform can run",
        "says 999 people",
    ]
    if share is not None:
        expected.append("rows grant more than VIEW")
    missing = [line for line in expected if line not in problems]
    assert not missing, f"--check did not report: {missing}\n\nit said:\n{problems}"


def test_the_repairs_mend_what_check_reports(session):
    from sqlalchemy import select

    from src.core.clock import now
    from src.models.business import Task
    from src.models.content import Tag
    from src.models.identity import Department, User, UserSession
    from src.models.personal import Favorite, Report, SavedSearch
    from src.models.platform import AlertRule, FeatureFlag
    from src.seed import catalog, runner

    # Sessions: two "current", one of them revoked.
    from sqlalchemy import func

    someone = session.scalar(select(UserSession.user_id).where(UserSession.user_id.is_not(None))
                             .group_by(UserSession.user_id).having(func.count() > 1).limit(1))
    s1, s2 = _rows(session, UserSession, 2, UserSession.user_id == someone)
    s1.is_current = s2.is_current = True
    s2.revoked_at = now()
    # Favourites still in the old per-row flags — one already bookmarked.
    report = _first(session, Report, Report.owner_id.is_not(None))
    report.is_favorite = True
    search = _first(session, SavedSearch, SavedSearch.owner_id.is_not(None))
    search.is_favorite = True
    session.add(Favorite(user_id=search.owner_id, resource_type="saved_search",
                         resource_id=str(search.id), label="x", url="/x", icon="search", position=99))
    # Tags out of step both ways, and a stale count.
    task = _first(session, Task, Task.tags.is_(None))
    task.tags = ["stale"]
    tag = _first(session, Tag)
    tag.usage_count = 999
    # A headcount nobody counted.
    department = _first(session, Department, Department.deleted_at.is_(None))
    department.headcount = 999
    # A navigation flag switched off at a rollout.
    flag = _first(session, FeatureFlag, FeatureFlag.key.in_(sorted(catalog.NAVIGATION_FLAGS)))
    flag.enabled, flag.rollout_percentage = False, 5
    # Saved searches: an undeclared filter key, and a missing list view.
    search.filters = {"q": "overdue", "status": "OPEN"}
    first_view = catalog.LIST_VIEWS[0][0]
    for row in session.scalars(select(SavedSearch).where(SavedSearch.name == first_view)):
        row.deleted_at = now()
    # Reports and automations that cannot run.
    broken = _rows(session, Report, 2)
    broken[0].dimensions, broken[0].metrics = ["nowhere"], ["median:x"]
    r1, r2, r3 = _rows(session, AlertRule, 3, AlertRule.deleted_at.is_(None))
    r1.resource_type, r1.enabled = "nowhere", True
    r2.condition_tree = {"type": "group", "children1": {"a": {"type": "rule", "properties": {
        "field": "no_such_field", "operator": "equal", "value": ["x"]}}}}
    r3.actions = [{"type": "notify", "audience": "OWNERS", "title": "t"}, {"kind": "TELEPORT"}, "junk"]
    session.flush()

    assert runner.sync_sessions(session)["corrected"] >= 1
    moved = runner.sync_favorites(session)
    assert moved == {"moved": 1, "already_bookmarked": 1}
    tags = runner.sync_tags(session)
    assert tags["cleared"] >= 1 and tags["recounted"] >= 1
    assert runner.sync_org(session)["corrected"] >= 1
    assert runner.sync_flags(session)["repaired"] == 1
    searches = runner.sync_searches(session)
    assert searches["cleaned"] >= 1 and searches["added"] >= 1
    assert runner.sync_reports(session)["repaired"] >= 1
    automations = runner.sync_automations(session)
    assert automations["paused"] >= 1 and automations["repaired"] >= 2
    session.flush()

    assert runner.verify(session) == []
    assert search.filters == {"status": "OPEN"}
    assert flag.enabled and flag.rollout_percentage == 100
    assert r1.enabled is False
    assert r3.actions[0]["kind"] == "NOTIFY" and all(a["kind"] != "TELEPORT" for a in r3.actions)

    # And each is idempotent: a second pass finds nothing.
    assert runner.sync_favorites(session)["moved"] == 0
    assert runner.sync_flags(session)["repaired"] == 0
    assert runner.sync_searches(session)["added"] == 0


def test_the_import_and_export_repairs_make_every_run_describable(session, tmp_path):
    """`--sync-imports` and `--sync-exports` on runs and exports that had drifted."""
    from src.core import importer
    from src.core.storage import LocalStorage
    from src.models.platform import BackgroundJob, ImportRun
    from src.seed import exports as export_files
    from src.seed import imports as import_seed
    from src.seed import runner

    a, b, c, d = _rows(session, ImportRun, 4)
    a.target_entity = "nowhere"                          # unreadable: left alone, counted
    b.target_entity, b.detected_columns, b.column_mapping = "task", [], {"ghost": "no_such_field"}
    b.status, b.total_rows, b.invalid_rows, b.skipped_rows = "COMPLETED", importer.MAX_ROWS * 2, 40, 10
    b.staged_rows, b.errors = [{"x": 1}], [{"row": 3}]  # the old error shape: no line
    c.target_entity, c.status, c.staged_rows, c.total_rows = "task", "DRAFT", [], 25
    d.target_entity, d.status, d.staged_rows, d.total_rows = "task", "VALIDATED", [], 30
    d.valid_rows, d.invalid_rows, d.skipped_rows = 0, 30, 0
    session.flush()

    result = import_seed.materialise(session)
    assert result["unreadable"] >= 1 and result["repaired"] >= 3 and result["staged"] >= 2
    assert b.total_rows <= importer.MAX_ROWS and b.staged_rows is None
    assert b.imported_rows == b.valid_rows == b.total_rows - b.invalid_rows - b.skipped_rows
    assert all("line" in problem for problem in (b.errors or []))
    assert c.step == "MAPPING" and 0 < len(c.staged_rows) == c.total_rows
    assert d.valid_rows > 0 and d.step == "PREVIEW"

    e1, e2, e3, e4 = _rows(session, BackgroundJob, 4, BackgroundJob.kind == "EXPORT")
    e1.payload = {}                                                     # cannot be planned
    # A legacy reference whose natural EXP- number is already taken.
    e2.reference = f"JOB-{int(e3.reference.split('-')[1]):07d}"
    e2.status, e2.result = "SUCCEEDED", {}                              # claims nothing
    e3.status, e3.result, e3.processed_units, e3.total_units = "FAILED", {"artifact": "x.csv"}, 3, 4
    e4.payload = {"entity": "ticket"}                                   # the legacy payload shape
    e4.status = "QUEUED"
    session.flush()

    store = LocalStorage(str(tmp_path / "objects"), secret="test", prefix="/files")
    fixed = export_files.materialise(session, store)
    assert fixed["renamed"] >= 1 and fixed["unreadable"] >= 1
    assert e2.reference.startswith("EXP-") and e2.result.get("artifact")
    assert store.stat(e2.result["artifact"]) is not None
    assert not (e3.result or {}).get("artifact") and e3.failed_units >= 1
    assert e4.payload.get("resource_type") and e4.processed_units == 0
    # A second pass has nothing left to write.
    assert export_files.materialise(session, store)["renamed"] == 0


def test_the_command_line_reports_drift_and_the_repairs_clear_it(scratch, monkeypatch, tmp_path, capsys):
    """The operator's view: `--check` exits 1 naming the drift; each repair says what it did.

    Last in the module because it commits to the scratch world — and leaves it
    consistent again, which is what it asserts.
    """
    from sqlalchemy import text

    from src.core import storage
    from src.core.auth import ROLE_DEFAULTS
    from src.core.storage import LocalStorage
    from src.seed.__main__ import main

    store = LocalStorage(str(tmp_path / "objects"), secret="test", prefix="/files")
    monkeypatch.setattr(storage, "for_config", lambda **_kwargs: store)

    with scratch.begin() as connection:
        connection.execute(text("ALTER TABLE tags DROP COLUMN description"))
        connection.execute(text(
            "UPDATE departments SET headcount = 999 WHERE id = (SELECT id FROM departments "
            "WHERE deleted_at IS NULL ORDER BY id LIMIT 1)"))
        code, definition = next(iter(ROLE_DEFAULTS.items()))
        connection.execute(text("UPDATE roles SET permissions = array_remove(permissions, :p) WHERE code = :c"),
                           {"p": definition["permissions"][0], "c": code})
        connection.execute(text(
            "UPDATE background_jobs SET payload = '{}'::jsonb WHERE id = (SELECT id FROM background_jobs "
            "WHERE kind = 'EXPORT' ORDER BY id LIMIT 1)"))
        connection.execute(text(
            "UPDATE import_runs SET target_entity = 'nowhere' WHERE id = (SELECT id FROM import_runs "
            "ORDER BY id LIMIT 1)"))

    # A column the check itself reads is gone: it says so instead of crashing.
    assert main(["--check"]) == 1
    out = capsys.readouterr().out
    assert "schema is behind the model" in out and "--sync-schema' first" in out

    assert main(["--sync-schema"]) == 0
    assert "+ tags.description" in capsys.readouterr().out
    assert main(["--sync-org"]) == 0
    assert main(["--sync-roles"]) == 0
    assert f"{code}: +" in capsys.readouterr().out
    assert main(["--sync-exports"]) == 0
    assert "cannot be read" in capsys.readouterr().out
    assert main(["--sync-imports"]) == 0
    assert "cannot be imported into" in capsys.readouterr().out

    # The schema matches again, so the rows are read and the drift named.
    with scratch.begin() as connection:
        connection.execute(text(
            "UPDATE departments SET headcount = 998 WHERE id = (SELECT id FROM departments "
            "WHERE deleted_at IS NULL ORDER BY id LIMIT 1)"))
    assert main(["--check"]) == 1
    assert "says 998 people" in capsys.readouterr().out
    assert main(["--sync-org"]) == 0
    capsys.readouterr()

    # Not repairable by a sync — the operator is told what is left.
    assert main(["--check"]) == 1
    left = capsys.readouterr().out
    assert "dataset has problems" in left and "people, has" not in left and "schema is behind" not in left
