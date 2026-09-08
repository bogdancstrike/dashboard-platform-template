"""Seed command — `python -m src.seed`.

    python -m src.seed                    # create tables if needed, then seed
    python -m src.seed --scale small      # a tenth of the data, for iterating
    python -m src.seed --reset            # drop everything first
    python -m src.seed --check            # verify an existing dataset
    python -m src.seed --sync-schema      # add columns the model has and it lacks
    python -m src.seed --sync-files       # write the bytes seeded files point at
    python -m src.seed --sync-roles       # give built-in roles new permissions
    python -m src.seed --sync-reports     # make unrunnable saved reports runnable
    python -m src.seed --sync-automations # make unrunnable automations runnable
    python -m src.seed --dry-run          # build in memory, write nothing

It refuses to seed a database that already has data unless `--reset` or
`--force` is given: the compose stack runs this on boot, and a seed that
silently doubles the dataset on every restart is worse than one that stops.
"""

from __future__ import annotations

import argparse
import sys

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
        "--sync-roles", action="store_true",
        help="add any newly declared permissions to the built-in roles and exit",
    )
    parser.add_argument(
        "--sync-automations", action="store_true",
        help="repair automations whose condition or actions the engine cannot run",
    )
    parser.add_argument(
        "--sync-reports", action="store_true",
        help="rewrite saved reports the analysis compiler would reject, and exit",
    )
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
        return 1 if blocked else 0

    if args.sync_files:
        # A file manager whose every download fails is not a demonstration of
        # a file manager. Idempotent, so this also repairs a database seeded
        # before object storage existed.
        with session_scope() as session:
            result = runner.sync_files(session)
        print(
            f"{result['written']} objects written, "
            f"{result['already_present']} already there"
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

    if args.check:
        # Two different questions, reported separately: whether the database
        # has the shape the model expects, and whether the rows in it hang
        # together. A dataset check that passes on a table missing a column is
        # a check that answered the easier question.
        behind = runner.schema_drift(engine)
        for item in behind:
            print(f"schema is behind the model: {item}")
        with session_scope() as session:
            problems = runner.verify(session)
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
        # a download that fails on a fresh install.
        runner.sync_files(session)
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
