"""The seed command line's arguments."""

from __future__ import annotations

import argparse

from src.config import Config


def build_parser() -> argparse.ArgumentParser:
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
