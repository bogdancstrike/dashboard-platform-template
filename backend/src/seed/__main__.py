"""Seed command — `python -m src.seed`.

    python -m src.seed                    # create tables if needed, then seed
    python -m src.seed --scale small      # a tenth of the data, for iterating
    python -m src.seed --reset            # drop everything first
    python -m src.seed --check            # verify an existing dataset
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

    if args.check:
        with session_scope() as session:
            problems = runner.verify(session)
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
