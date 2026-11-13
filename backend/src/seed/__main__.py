"""Seed command — `python -m src.seed`.

Rationale: docs/architecture/backend/modules/seed---main--.md
"""

from __future__ import annotations

import sys

from sqlalchemy.exc import DBAPIError

from src.seed.cli.commands import COMMANDS
from src.seed.cli.parser import build_parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)

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

    for names, command in COMMANDS:
        if any(getattr(args, name) for name in names):
            return command(args, engine)

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
