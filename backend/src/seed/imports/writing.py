"""Seed data for imports: materialise."""

from __future__ import annotations

from sqlalchemy import select

from src.seed.imports.repair_counts import _repair_counts, _repair_rows, _snapshot


def materialise(session) -> dict[str, int]:
    """Make every seeded import run true. Returns a tally the runner prints."""
    from src.models.platform import ImportRun
    from src.services.records import explorer

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


def _repair_mapping(row, resource) -> None:
    """Give the run columns its target could actually be mapped from.

    Derived from the target's own writable declarations, headed the way a
    person writing a spreadsheet would head them — plus one column nothing
    maps onto, because every real export carries an internal id.

    Only rewritten when it needs to be: a run whose mapping already names real
    columns and real fields is left exactly as it is, which is what makes this
    idempotent.
    """
    from src.core.clock import now
    from src.seed.operations import _import_columns
    from src.seed.support import Rng

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
