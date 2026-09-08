"""Making the seeded import runs describe files that could exist (§29).

The third of these content repairs, after `seed/blobs` for files and
`seed/exports` for export artefacts, and the same argument each time: a demo
row that claims something untrue is worse than no row, because the page built
to read it has to apologise for it.

What the seeded import runs claimed, all of it found by building `/import`:

**Counts that could not all be true.** `valid = total - invalid` was written
beside a separate non-zero `skipped`, so a run reported 24,234 valid, 619
invalid and 1,055 skipped out of 24,853 — three numbers, no two of which
agreed.

**A mapping onto fields the target does not have.** Every run was given the
same five column names whatever it imported into, and four of them were mapped
onto `code`, `country`, `email` and `name` — which `order` and `task` do not
accept. So the wizard could not describe a single seeded run, and an execute
would have been refused by the write rules on every row.

**More rows than an import may carry.** Up to 25,000 against a cap of 5,000.

**An open draft with no rows in it.** The wizard's whole purpose is that a
draft can be resumed and its mapping changed without re-uploading — and every
seeded draft resumed to an empty preview.

**Errors keyed as `row` with no value.** The error report has four columns and
three of them would have been blank.

This module repairs each of those on an existing database. It never invents a
run and never deletes one: what it edits is derived — the columns from the
target's declarations, the counts from the rows, the rows from the columns.
Idempotent, so `--sync-imports` is safe to run on every seed and on a database
that predates any of this.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select


def materialise(session) -> dict[str, int]:
    """Make every seeded import run true. Returns a tally the runner prints."""
    from src.models.platform import ImportRun
    from src.services import explorer

    repaired = 0
    staged = 0
    cleared = 0
    unreadable = 0
    already = 0

    targets = {
        key: resource
        for key, resource in explorer.resources().items()
        if resource.identity is not None
    }

    for row in session.scalars(select(ImportRun)).all():
        resource = targets.get(row.target_entity)
        if resource is None:
            # A run naming a dataset that is gone, or one that cannot be
            # created. Reported rather than repointed: guessing which dataset
            # somebody meant to import into would be inventing history.
            unreadable += 1
            continue

        before = _snapshot(row)
        _repair_mapping(row, resource)
        _repair_rows(row, resource)
        counted = _repair_counts(row)
        staged += counted["staged"]
        cleared += counted["cleared"]

        if _snapshot(row) != before:
            repaired += 1
        else:
            already += 1

    session.flush()
    return {
        "repaired": repaired,
        "staged": staged,
        "cleared": cleared,
        "unreadable": unreadable,
        "already_true": already,
    }


def _snapshot(row) -> tuple:
    """Everything this repair may touch, for deciding whether it changed."""
    return (
        row.total_rows,
        row.valid_rows,
        row.invalid_rows,
        row.skipped_rows,
        row.imported_rows,
        row.step,
        tuple(sorted((row.column_mapping or {}).items())),
        tuple(str(item.get("name")) for item in (row.detected_columns or [])),
        len(row.staged_rows or []),
        tuple(sorted(problem.get("message", "") for problem in (row.errors or []))),
    )


def _repair_mapping(row, resource) -> None:
    """Give the run columns its target could actually be mapped from.

    Derived from the target's own writable declarations, headed the way a
    person writing a spreadsheet would head them — plus one column nothing
    maps onto, because every real export carries an internal id.

    Only rewritten when it needs to be: a run whose mapping already names real
    columns and real fields is left exactly as it is, which is what makes this
    idempotent.
    """
    from src.seed.operations import _import_columns
    from src.seed.support import Rng
    from src.core.clock import now

    columns = {str(item.get("name")) for item in (row.detected_columns or [])}
    mapping = row.column_mapping or {}
    writable = set(resource.writable)

    sound = (
        columns
        and mapping
        and not (set(mapping) - columns)
        and not (set(mapping.values()) - writable)
    )
    if sound:
        return

    # Seeded from the run's own id, so the repair is deterministic per row and
    # a second pass produces the same answer rather than a different one.
    rng = Rng(int(str(row.id).replace("-", "")[:12], 16), now()).derive("import-repair")
    rebuilt, remapped = _import_columns(rng, resource)
    row.detected_columns = rebuilt
    row.column_mapping = remapped
    # The old errors named the old columns, so they are no longer about
    # anything. Rebuilt below from the counts.
    row.errors = None


def _repair_rows(row, resource) -> None:
    """Hold the file when the run is open, and let it go when it is not."""
    from src.core import importer
    from src.core.clock import now
    from src.seed.operations import _import_rows
    from src.seed.support import Rng

    open_run = row.status in ("DRAFT", "VALIDATED")

    if row.total_rows > importer.MAX_ROWS:
        # Brought inside the cap the wizard enforces — the number was drawn at
        # random in the first place, so nothing is lost by drawing a smaller
        # one, and a run claiming 25,000 rows is one the product would refuse
        # to create.
        #
        # *Scaled*, not clamped. `_repair_counts` reads `invalid` and `skipped`
        # off the row, and clamping a total from 21,202 to 400 beside an
        # `invalid` of 2,360 left every row invalid and none valid — a
        # VALIDATED run with nothing to import. The same mistake as clamping
        # an export's progress to a smaller total, made twice in one evening,
        # which is why both now keep the proportion.
        factor = min(400, importer.MAX_ROWS) / row.total_rows
        row.total_rows = min(400, importer.MAX_ROWS)
        row.invalid_rows = int(row.invalid_rows * factor)
        row.skipped_rows = int(row.skipped_rows * factor)

    if open_run:
        if not (row.staged_rows or []):
            rng = Rng(int(str(row.id).replace("-", "")[:12], 16), now()).derive("import-rows")
            row.staged_rows = _import_rows(
                rng, row.detected_columns or [], min(row.total_rows, 60)
            )
        # An open run's total *is* the rows it holds. They were two independent
        # numbers before, so a draft could claim four hundred rows and hold
        # sixty — and the wizard's preview footer would have said "60 of 400"
        # about a file that had sixty rows in it.
        row.total_rows = len(row.staged_rows or [])
    elif row.staged_rows or []:
        # Finished, and still holding a copy of somebody's spreadsheet.
        row.staged_rows = None


def _repair_counts(row) -> dict[str, int]:
    """Make the four counts add up, and the step match the status."""
    from src.seed.operations import _import_errors

    staged = 1 if (row.staged_rows or []) else 0
    cleared = 0

    if row.status == "DRAFT":
        # Read, not yet validated: the outcome counts are not facts yet, and
        # writing numbers into them was what made them contradict each other.
        row.valid_rows = row.invalid_rows = row.skipped_rows = 0
        row.imported_rows = 0
        row.errors = row.errors or None
        row.step = "MAPPING"
        return {"staged": staged, "cleared": cleared}

    total = max(row.total_rows, 0)
    invalid = max(row.invalid_rows, 0)
    skipped = max(row.skipped_rows, 0)

    if total - invalid - skipped <= 0:
        # No room left for a single valid row, which cannot be true of a run
        # that got past DRAFT: it could not have been validated, let alone
        # executed. The counts no longer fit because the repair has made the
        # file smaller than the one they were drawn for, so they are re-derived
        # at the *generator's own proportions* — an eighth wrong and a
        # twentieth skipped, which is what `_import_runs` draws.
        #
        # `> total` was the first condition here and was not enough: sixty
        # invalid out of sixty rows *fits*, and is still a validated run with
        # nothing to import.
        #
        # Clamping was tried twice and produced the same wrong answer both
        # times: `min(invalid, total)` on a total that had shrunk from 21,202
        # to 60 left all sixty rows invalid, none valid, and a VALIDATED run
        # with nothing to import. Two adjustments each doing their own
        # arithmetic is how that happened, so this is the one place the four
        # counts are decided.
        invalid = total // 8
        skipped = total // 20

    row.invalid_rows = invalid
    row.skipped_rows = skipped
    row.valid_rows = total - invalid - skipped
    row.imported_rows = row.valid_rows if row.status == "COMPLETED" else 0
    row.step = {"VALIDATED": "PREVIEW", "RUNNING": "EXECUTE"}.get(row.status, "DONE")

    if invalid and not _errors_are_readable(row):
        from src.core.clock import now
        from src.seed.support import Rng

        rng = Rng(int(str(row.id).replace("-", "")[:12], 16), now()).derive("import-errors")
        row.errors = _import_errors(rng, row.column_mapping or {}, total, invalid)
        cleared = 1
    elif not invalid and (row.errors or []):
        row.errors = None
        cleared = 1

    return {"staged": staged, "cleared": cleared}


def _errors_are_readable(row) -> bool:
    """Whether the stored problems are about this file and agree with its counts.

    Three things, and each was false at some point. The old shape keyed the
    line as `row` and carried no value, so the downloadable report would have
    had three empty columns out of four. The columns it named were the ones the
    mapping repair replaced. And the *number of lines* it named could exceed
    `invalid_rows`, which counts lines — a repair rebuilt the counts down to
    seven and left twelve problems describing seven bad rows.
    """
    problems: list[dict[str, Any]] = row.errors or []
    if not problems:
        return False
    columns = {str(item.get("name")) for item in (row.detected_columns or [])}
    shaped = all(
        "line" in problem
        and problem.get("column") in columns
        and problem.get("message")
        for problem in problems
    )
    lines = {problem.get("line") for problem in problems if "line" in problem}
    return shaped and len(lines) <= max(row.invalid_rows, 0)
