"""Seed command — `python -m src.seed`.

    python -m src.seed                    # create tables if needed, then seed
    python -m src.seed --scale small      # a tenth of the data, for iterating
    python -m src.seed --reset            # drop everything first
    python -m src.seed --check            # verify an existing dataset
    python -m src.seed --sync-schema      # add columns the model has and it lacks
    python -m src.seed --sync-files       # write the bytes seeded files point at
    python -m src.seed --sync-exports     # write the file every seeded export claims
    python -m src.seed --sync-imports     # make every seeded import run describe a real file
    python -m src.seed --sync-sessions    # one current session per person, and only a live one
    python -m src.seed --sync-favorites   # move the old per-row is_favorite flags into one store
    python -m src.seed --sync-tags        # make each record's tags array agree with its links
    python -m src.seed --sync-searches    # drop filter keys no dataset declares, add the list views
    python -m src.seed --sync-roles       # give built-in roles new permissions
    python -m src.seed --sync-reports     # make unrunnable saved reports runnable
    python -m src.seed --sync-automations # make unrunnable automations runnable
    python -m src.seed --sync-mailboxes  # give each demo persona an inbox worth opening
    python -m src.seed --sync-settings   # bring each setting's declaration up to date
    python -m src.seed --sync-jobs       # give every job status at least one job
    python -m src.seed --sync-org        # make each department's headcount agree with its people
    python -m src.seed --sync-health     # give every service a month of history to draw
    python -m src.seed --sync-flags      # create catalogue flags, reset untouched ones to default
    python -m src.seed --reset-flags     # every catalogue flag back to its seeded default
    python -m src.seed --sync-activity   # give each organization a feed it can filter
    python -m src.seed --sync-preferences # fill in preference keys an account predates
    python -m src.seed --sync-approvals  # change rules and a queue of approval requests
    python -m src.seed --sync-time       # six weeks of time entries and timesheets
    python -m src.seed --sync-sla        # business calendars and SLA policies, applied to tickets
    python -m src.seed --sync-forms      # intake forms and their submissions
    python -m src.seed --sync-collab      # chat channels, a wiki and meeting notes, if missing
    python -m src.seed --sync-assistant   # add the seeded assistant conversations that are missing
    python -m src.seed --sync-knowledge  # add the seeded document collections that are missing
    python -m src.seed --sync-dashboards # reset dashboard/widget periods the analysis engine cannot read
    python -m src.seed --sync-report-documents # weekly/monthly report documents for the Report builder
    python -m src.seed --sync-folders    # rename sibling folders that share a name
    python -m src.seed --sync-insights   # add the seeded insights (and the dashboard widget) that are missing
    python -m src.seed --sync-planning   # sprints, epics, a timeline and templates for the work queue
    python -m src.seed --sync-analytics  # customer health, contracts, version histories, alerts, public links
    python -m src.seed --sync-workflows  # a graph for every automation, demo canvas workflows and their runs
    python -m src.seed --sync-developers  # real API examples and two weeks of API usage (§31)
    python -m src.seed --sync-onboarding  # onboarding checklists in progress (§38)
    python -m src.seed --dry-run          # build in memory, write nothing

It refuses to seed a database that already has data unless `--reset` or
`--force` is given: the compose stack runs this on boot, and a seed that
silently doubles the dataset on every restart is worse than one that stops.
"""

from __future__ import annotations

import argparse
import sys

from sqlalchemy.exc import DBAPIError

from src.config import Config


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m src.seed", description="Seed Nucleus demo data.")
    parser.add_argument(
        "--scale", default=Config.SEED_SCALE, choices=("full", "small"),
        help="how much data to generate (default: %(default)s)",
    )
    parser.add_argument(
        "--seed", type=int, default=Config.SEED_RANDOM_SEED,
        help="random seed; the same value reproduces the same graph (default: %(default)s)",
    )
    parser.add_argument("--reset", action="store_true", help="drop every table before seeding")
    parser.add_argument("--force", action="store_true", help="seed even if data is already present")
    parser.add_argument("--check", action="store_true", help="verify the existing dataset and exit")
    parser.add_argument(
        "--sync-schema", action="store_true",
        help="add columns the model declares and the database lacks, and exit",
    )
    parser.add_argument(
        "--sync-files", action="store_true",
        help="write the object bytes every seeded file points at, and exit",
    )
    parser.add_argument(
        "--sync-exports", action="store_true",
        help="write the file every seeded export claims, and make its counts describe it",
    )
    parser.add_argument(
        "--sync-imports", action="store_true",
        help="make every seeded import run describe a file that could exist",
    )
    parser.add_argument(
        "--sync-favorites", action="store_true",
        help="move the old per-row is_favorite flags into the one favourites store",
    )
    parser.add_argument(
        "--sync-tags", action="store_true",
        help="make each record's tags array agree with its tag links",
    )
    parser.add_argument(
        "--sync-searches", action="store_true",
        help="drop filter keys no dataset declares, and add the missing list views",
    )
    parser.add_argument(
        "--sync-sessions", action="store_true",
        help="leave at most one current session per person, and only a live one",
    )
    parser.add_argument(
        "--sync-roles", action="store_true",
        help="add any newly declared permissions to the built-in roles and exit",
    )
    parser.add_argument(
        "--sync-settings", action="store_true",
        help="update each setting's label, type, options and default, keeping chosen values",
    )
    parser.add_argument(
        "--sync-mailboxes", action="store_true",
        help="top each demo persona's inbox up to the guaranteed minimum",
    )
    parser.add_argument(
        "--sync-org", action="store_true",
        help="recount each department's headcount from the people actually in it",
    )
    parser.add_argument(
        "--reset-flags", action="store_true",
        help="put every catalogue feature flag back at its seeded default, decisions included",
    )
    parser.add_argument(
        "--sync-flags", action="store_true",
        help="create every catalogue feature flag, relabel them, reset never-touched ones to their default",
    )
    parser.add_argument(
        "--sync-activity", action="store_true",
        help="give every organization at least one activity entry per dataset it has records for",
    )
    parser.add_argument(
        "--sync-preferences", action="store_true",
        help="fill in preference keys an account's stored blob predates, and expand collapsed sidebars",
    )
    parser.add_argument(
        "--sync-health", action="store_true",
        help="give every monitored service a month of history, so the charts have something to draw",
    )
    parser.add_argument(
        "--sync-jobs", action="store_true",
        help="add one job for any status the queue console can filter by and never match",
    )
    parser.add_argument(
        "--sync-automations", action="store_true",
        help="repair automations whose condition or actions the engine cannot run",
    )
    parser.add_argument(
        "--sync-reports", action="store_true",
        help="rewrite saved reports the analysis compiler would reject, and exit",
    )
    parser.add_argument(
        "--sync-dashboards", action="store_true",
        help="reset dashboard and widget periods the analysis engine cannot read, and exit",
    )
    parser.add_argument(
        "--sync-report-documents", action="store_true",
        help="add the seeded report documents (Report builder) that are missing, and exit",
    )
    parser.add_argument(
        "--sync-folders", action="store_true",
        help="rename sibling folders that share a name (three '2024's under one parent), and exit",
    )
    parser.add_argument(
        "--sync-insights", action="store_true",
        help="add the seeded insights and their dashboard widget that are missing, and exit",
    )
    parser.add_argument(
        "--sync-knowledge", action="store_true",
        help="add the seeded document collections (Ask your documents) that are missing, and exit",
    )
    parser.add_argument(
        "--sync-assistant", action="store_true",
        help="add the seeded AI assistant conversations that are missing, and exit",
    )
    parser.add_argument(
        "--sync-analytics", action="store_true",
        help="add customer health history, contracts, record version histories, metric watches and "
        "public dashboard links, and exit",
    )
    parser.add_argument(
        "--sync-planning", action="store_true",
        help="add sprints with history, epics, dependencies, templates and recurring tasks, and exit",
    )
    parser.add_argument(
        "--sync-collab", action="store_true",
        help="add the demo chat channels, wiki spaces and meeting notes that are missing, and exit",
    )
    for flag, what in (("approvals", "change rules and a queue of approval requests"),
                       ("time", "six weeks of time entries and timesheets"),
                       ("sla", "business calendars and SLA policies, applied to every ticket"),
                       ("forms", "intake forms and their submissions")):
        parser.add_argument(f"--sync-{flag}", action="store_true", help=f"add {what} if missing, and exit")
    parser.add_argument(
        "--sync-workflows", action="store_true",
        help="give every automation its graph and add the demo canvas workflows with run history, and exit",
    )
    parser.add_argument("--sync-developers", action="store_true", help="add captured API examples and top up two weeks of API client usage, and exit")
    parser.add_argument("--sync-onboarding", action="store_true", help="add onboarding progress for the demo personas, and exit")
    parser.add_argument("--dry-run", action="store_true", help="build in memory, write nothing")
    parser.add_argument("--quiet", action="store_true", help="only print the summary line")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)

    from framework.commons.logger import logger as log

    from src.core.db import get_engine, session_scope
    from src.seed import runner
    from src.seed.world import SCALES

    if args.dry_run:
        world = runner.generate(scale=SCALES[args.scale], seed=args.seed)
        _report(world.counts(), quiet=args.quiet)
        print(f"dry run: {world.total()} rows built, nothing written")
        return 0

    engine = get_engine()

    if args.sync_schema:
        # Additive only. A column that cannot be added without deciding what
        # existing rows get is reported rather than guessed at.
        added = runner.sync_schema(engine)
        for item in added:
            print(f"  + {item.table}.{item.column}")
        blocked = runner.schema_drift(engine)
        for item in blocked:
            print(f"  ! {item}")
        if not added:
            print("database already matches the model")
        else:
            tables = sum(1 for item in added if not item.column)
            columns = len(added) - tables
            parts = [f"{tables} table(s) created"] if tables else []
            parts += [f"{columns} column(s) added"] if columns else []
            print(", ".join(parts))
        if not blocked:
            # A database whose schema now matches the models is a database at
            # the latest revision, and saying so is what stops the first
            # `make migrate` on it from trying to create every table again.
            # Only ever *recorded*, never assumed: `stamp_head` refuses a
            # database that already carries a revision.
            stamped = runner.stamp_head(engine)
            if stamped:
                print(f"recorded schema revision {stamped}")
        return 1 if blocked else 0

    if args.sync_analytics:
        # Records & analytics (§12, §13, §17, §22, §25) for a database seeded
        # before them: idempotent — each part adds only what is missing.
        from src.seed import records_analytics

        with session_scope() as session:
            result = records_analytics.populate(session)
        print(", ".join(f"{count} {name.replace('_', ' ')}" for name, count in result.items()))
        return 0

    if args.sync_workflows:
        # The visual workflow builder (§49) for a database seeded before it.
        from src.seed import workflows

        with session_scope() as session:
            result = workflows.populate(session)
        print(", ".join(f"{count} {name}" for name, count in result.items()))
        return 0

    if args.sync_developers:
        from src.seed import developers as feature_seed

        with session_scope() as session:
            result = feature_seed.populate(session)
        print(", ".join(f"{count} {name.replace('_', ' ')}" for name, count in result.items()))
        return 0

    if args.sync_onboarding:
        from src.seed import onboarding as feature_seed

        with session_scope() as session:
            result = feature_seed.populate(session)
        print(", ".join(f"{count} {name.replace('_', ' ')}" for name, count in result.items()))
        return 0

    if args.sync_planning:
        # Work planning (§18) for a database seeded before it existed:
        # idempotent — the structure is added once, the fill-ins only touch
        # what is empty.
        from src.seed import planning

        with session_scope() as session:
            result = planning.populate(session)
        print(", ".join(f"{count} {name.replace('_', ' ')}" for name, count in result.items()))
        return 0

    if args.sync_approvals or args.sync_time or args.sync_sla or args.sync_forms:
        # Time & decisions for a database seeded before it existed. Additive and
        # idempotent: each part is skipped when its rows are already there.
        from src.seed import decisions

        with session_scope() as session:
            for flag, step in (("sync_sla", decisions.populate_sla),
                               ("sync_approvals", decisions.populate_approvals),
                               ("sync_time", decisions.populate_time),
                               ("sync_forms", decisions.populate_forms)):
                if getattr(args, flag):
                    result = step(session)
                    print(f"{flag[5:]}: " + ", ".join(f"{count} {name}" for name, count in result.items()))
        return 0

    if args.sync_files:
        # A file manager whose every download fails is not a demonstration of
        # a file manager. Idempotent, so this also repairs a database seeded
        # before object storage existed.
        with session_scope() as session:
            result = runner.sync_files(session)
        print(
            f"{result['written']} objects written "
            f"({result['upgraded']} placeholder image(s) replaced), "
            f"{result['already_present']} already there"
        )
        return 0

    if args.sync_exports:
        # A seeded export used to claim `{"rows": 184203, "artifact": …}` for a
        # file nobody had written. This produces the file and makes the counts
        # describe it. Idempotent.
        with session_scope() as session:
            result = runner.sync_exports(session)
        print(
            f"{result['written']} export files written "
            f"({result['guaranteed']} for personas who had none), "
            f"{result['corrected']} row(s) corrected, "
            f"{result['renamed']} renamed, "
            f"{result['already_present']} already there"
        )
        if result["unreadable"]:
            print(f"  ! {result['unreadable']} export(s) name a query that cannot be read")
        return 0

    if args.sync_imports:
        # A seeded import run used to claim counts that could not all be true
        # and a mapping onto fields its target does not have. Idempotent.
        with session_scope() as session:
            result = runner.sync_imports(session)
        print(
            f"{result['repaired']} import run(s) repaired "
            f"({result['staged']} hold their file, {result['cleared']} error lists rebuilt), "
            f"{result['already_true']} already true"
        )
        if result["unreadable"]:
            print(f"  ! {result['unreadable']} run(s) name a dataset that cannot be imported into")
        return 0

    if args.sync_favorites:
        # Two stores for one fact: the per-row `is_favorite` flags move into
        # `favorites` and the columns are cleared. Idempotent.
        with session_scope() as session:
            result = runner.sync_favorites(session)
        print(
            f"{result['moved']} star(s) moved into favourites, "
            f"{result['already_bookmarked']} already there"
        )
        return 0

    if args.sync_tags:
        # The array is a *derived* cache of `tag_links` with one writer. This
        # brings a database that predates that rule into line: it rewrites the
        # array wherever there are links and clears it wherever there are not,
        # because a string left behind after its link went is the stale value
        # the single-writer rule exists to prevent. Idempotent.
        with session_scope() as session:
            result = runner.sync_tags(session)
        print(
            f"{result['rewritten']} record(s) rewritten from their links, "
            f"{result['cleared']} stale array(s) cleared, "
            f"{result['recounted']} usage count(s) corrected"
        )
        return 0

    if args.sync_searches:
        # A saved search whose filters name a field no dataset declares is a
        # filter that narrows nothing — invisible until the entity lists could
        # apply one (§46). And a dataset whose saved searches all carry
        # condition trees has a views menu that can only link elsewhere, so the
        # six list views are added if they are missing. Additive, idempotent.
        with session_scope() as session:
            result = runner.sync_searches(session)
        print(
            f"{result['cleaned']} saved search(es) had unusable filter keys removed, "
            f"{result['added']} list view(s) added"
        )
        return 0

    if args.sync_sessions:
        # `is_current` is derived from the most recent live sign-in, and the
        # seed used to mark the first five sessions of every user. Idempotent.
        with session_scope() as session:
            result = runner.sync_sessions(session)
        print(
            f"{result['corrected']} session flag(s) corrected across "
            f"{result['people']} people"
        )
        return 0

    if args.sync_roles:
        # Not part of a seed run: this is what an *existing* database needs
        # when the permission catalogue grows, and seeding refuses to touch a
        # populated one.
        with session_scope() as session:
            added = runner.sync_roles(session)
        for code, permissions in sorted(added.items()):
            print(f"  {code}: +{', '.join(permissions)}")
        print("roles already match the catalogue" if not added else "roles updated")
        return 0

    if args.sync_reports:
        # Every report seeded before the generator derived its columns from
        # the declarations names a column that does not exist, and `--check`
        # reports them. This is the way out that is not a destructive reseed.
        with session_scope() as session:
            result = runner.sync_reports(session)
        print(
            f"{result['repaired']} report(s) repaired"
            + (f", {result['orphaned']} on a dataset that no longer exists" if result["orphaned"] else "")
        )
        return 0

    if args.sync_automations:
        # The report repair's sibling (§49). A rule watching a dataset that
        # does not exist is paused rather than left claiming to be live: a
        # monitor that cannot look reports quiet, which is indistinguishable
        # from good news.
        with session_scope() as session:
            result = runner.sync_automations(session)
        print(
            f"{result['repaired']} automation(s) repaired"
            + (f", {result['paused']} paused for want of a dataset" if result["paused"] else "")
        )
        return 0

    if args.sync_mailboxes:
        # The mailbox generator's folder draw is random and left the
        # administrator's inbox empty at the small scale — an empty inbox on a
        # demo reads as a broken feature. Additive and idempotent: it counts
        # what is there and only inserts what is missing.
        with session_scope() as session:
            result = runner.sync_mailboxes(session)
        print(
            f"{result['added']} thread(s) added across {result['personas']} persona(s)"
            if result["added"]
            else "every persona already has an inbox"
        )
        return 0

    if args.sync_org:
        # An *edit*, unlike the other repairs — safe because the column is
        # derived: `users.department_id` is the truth, and this only stops the
        # cached copy contradicting it.
        with session_scope() as session:
            result = runner.sync_org(session)
        print(
            f"{result['corrected']} departments recounted"
            if result["corrected"]
            else "every department already agrees with its people"
        )
        return 0

    if args.sync_flags or args.reset_flags:
        # A rollout percentage is how a team ships something gradually, and the
        # seed was applying one to finished features — so `/dashboards` was
        # missing from the navigation of every demo persona (§27). Only ever
        # turns one *on*: somebody who switched a flag off made a decision.
        with session_scope() as session:
            result = runner.sync_flags(session, reset=args.reset_flags)
        print(
            f"flags: {result['created']} created, {result['reset']} reset to default, "
            f"{result['relabelled']} relabelled, {result['removed']} retired "
            f"({result['checked']} in the catalogue)"
        )
        return 0

    if args.sync_activity:
        # The history was drawn from one flat pool of every record, so a
        # dataset was the subject of an event in proportion to its volume —
        # and once scoped to an organization, the administrator's own project
        # filter matched nothing (§34). Additive: an entry records something
        # that happened, and rewriting one would be a lie about the past.
        with session_scope() as session:
            result = runner.sync_activity(session)
        print(
            f"{result['added']} entries added across {result['organizations']} organizations"
            if result["added"]
            else "every organization can already filter the feed by any dataset"
        )
        return 0

    if args.sync_preferences:
        # The declaration in `services/me.py` gains a key and every account
        # seeded before it has a blob without one (§40). Additive, except the
        # seeded collapsed sidebar — a rail of unlabelled icons on first sign-in
        # reads as broken navigation, not as somebody's preference.
        with session_scope() as session:
            result = runner.sync_preferences(session)
        print(
            f"{result['filled']} accounts filled in, {result['expanded']} sidebars expanded"
            if result["filled"]
            else "every account's preferences are already complete"
        )
        return 0

    if args.sync_dashboards:
        from src.seed import dashboard_periods

        with session_scope() as session:
            result = dashboard_periods.sync(session)
        print(f"{result['dashboards']} dashboard periods and {result['widgets']} widget periods reset")
        return 0

    if args.sync_report_documents:
        # Additive and by owner + name: a document already there is left alone.
        from src.seed import report_documents as report_documents_seed

        with session_scope() as session:
            result = report_documents_seed.seed(session)
        print(f"{result['documents']} report documents added")
        return 0

    if args.sync_folders:
        from src.seed.content import dedupe_folders

        with session_scope() as session:
            result = dedupe_folders(session)
        print(f"{result['renamed']} folders renamed")
        return 0

    if args.sync_insights:
        from src.seed import insights as insights_seed

        with session_scope() as session:
            result = insights_seed.seed(session)
        print(f"{result['insights']} insights and {result['widgets']} dashboard widget added")
        return 0

    if args.sync_knowledge:
        # Additive: a collection already there (seeded or anybody's) is left alone.
        from src.seed import knowledge as knowledge_seed

        with session_scope() as session:
            result = knowledge_seed.seed(session)
        print(f"{result['collections']} collections and {result['documents']} documents added")
        return 0

    if args.sync_assistant:
        # Additive: a persona's conversation with the same title is left alone.
        from src.seed import assistant as assistant_seed

        with session_scope() as session:
            result = assistant_seed.seed(session)
        print(f"{result['conversations']} assistant conversations and {result['messages']} messages added")
        return 0

    if args.sync_collab:
        # Additive and by name: a channel, space or page somebody already has
        # (or has since edited) is left alone, so this is safe to run again.
        from src.seed import collab

        runner.bootstrap_schema(engine)
        with session_scope() as session:
            result = collab.seed(session)
        print(", ".join(f"{count} {name}" for name, count in result.items()) + " added")
        return 0

    if args.sync_health:
        # The history column was seeded with twenty-four points, which is one
        # day — so the 7d and 30d windows on `/admin/health` drew nothing on a
        # database seeded before this. An *edit*, and safe for the same reason
        # `--sync-org` is: nothing here is a decision anybody made.
        with session_scope() as session:
            result = runner.sync_health(session)
        print(
            f"{result['extended']} services given {result['points']} points of history"
            if result["extended"]
            else "every service already has a month of history"
        )
        return 0

    if args.sync_jobs:
        # `JOB_STATUS` is what `/admin/jobs` builds its filters from, and
        # RETRYING is weighted low enough that a small scale often leaves it
        # empty — a filter that can never match anything (§76). Additive: it
        # never edits an existing job, because a job's status is a record of
        # what happened.
        with session_scope() as session:
            result = runner.sync_jobs(session)
        print(
            f"{result['added']} added"
            + (
                f" covering {result['statuses']} statuses"
                if result["added"]
                else " — every status already has the guaranteed minimum"
            )
        )
        return 0

    if args.sync_settings:
        # What an ordinary deploy needs: the catalogue gains a setting, or an
        # existing one gains a type and a range, and seeding refuses to touch a
        # populated database. Chosen values survive; a value that no longer
        # fits its own declaration is reset, and counted separately.
        with session_scope() as session:
            result = runner.sync_settings(session)
        print(
            f"{result['added']} added, {result['updated']} updated"
            + (f", {result['reset']} reset to the new default" if result["reset"] else "")
        )
        return 0

    if args.check:
        # Two different questions, reported separately: whether the database
        # has the shape the model expects, and whether the rows in it hang
        # together. A dataset check that passes on a table missing a column is
        # a check that answered the easier question.
        behind = runner.schema_drift(engine)
        for item in behind:
            print(f"schema is behind the model: {item}")
        try:
            with session_scope() as session:
                problems = runner.verify(session)
        except DBAPIError:
            # A missing column fails the very queries that would describe the
            # rows — which is what a database behind its model looks like, so
            # say what to do rather than end in a traceback.
            if not behind:
                raise
            print("the rows cannot be checked until the schema is: "
                  "run 'python -m src.seed --sync-schema' first")
            return 1
        if behind and not problems:
            print("run 'python -m src.seed --sync-schema' to add what can be added")
            return 1
        if problems:
            print("dataset has problems:")
            for problem in problems:
                print(f"  - {problem}")
            return 1
        print("dataset is consistent")
        return 0

    if args.reset:
        log.warning("dropping every table before seeding", "yellow")
        runner.drop_schema(engine)

    runner.bootstrap_schema(engine)

    with session_scope() as session:
        if runner.is_seeded(session) and not (args.reset or args.force):
            print(
                "database already contains data; nothing written. "
                "Use --reset to rebuild it or --force to add another dataset."
            )
            return 0

        counts = runner.run(session, scale=args.scale, seed=args.seed)
        # The bytes, not only the rows: a seeded file that points at nothing is
        # a download that fails on a fresh install, and a seeded export that
        # claims one is worse — it says how many rows are in a file nobody
        # wrote (§30).
        runner.sync_files(session)
        runner.sync_exports(session)
        runner.sync_imports(session)
        runner.sync_sessions(session)
        runner.sync_favorites(session)
        problems = runner.verify(session)

    _report(counts, quiet=args.quiet)
    if problems:
        print("\nconsistency problems:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1

    print(f"\nseeded {sum(counts.values())} rows across {len(counts)} tables — consistent")
    return 0


def _report(counts: dict[str, int], *, quiet: bool) -> None:
    if quiet:
        return
    width = max(len(name) for name in counts)
    for name, count in sorted(counts.items(), key=lambda item: -item[1]):
        if count:
            print(f"  {name:<{width}}  {count:>7,}")


if __name__ == "__main__":
    raise SystemExit(main())
