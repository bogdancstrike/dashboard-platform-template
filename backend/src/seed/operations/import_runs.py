"""Seed data for operations: _import_runs, _watchable."""

from __future__ import annotations

from src.seed.operations.import_errors import (
    _import_columns,
    _import_errors,
    _import_rows,
)
from src.seed.support import reference
from src.seed.world import World


def _watchable(resource_type: str) -> tuple[str, tuple[str, ...]] | None:
    """A status-like field of a dataset, and the values it actually takes.

    Derived from the `Resource` declaration and its vocabulary rather than
    typed out, for the reason the seeded *reports* taught: this function's
    predecessor built every rule out of a literal `priority` / `status` pair
    and a hand-made `FieldSet`, and pointed rules at `"job"`, `"user"` and
    `"file"` — three keys the explorer does not declare. So half the seeded
    automations watched a dataset that cannot be selected from, and the other
    half stored a `condition_text` rendered against fields the engine would
    compile against a *different* set. Every one of them was unrunnable, which
    is what somebody finds the moment they open the page and press Dry run.
    """
    from src.services.records.explorer import resources

    resource = resources().get(resource_type)
    if resource is None:
        return None
    for name in (resource.status_field, "priority", "status"):
        field = resource.fields.by_name.get(name) if name else None
        if field is not None and field.kind == "enum" and field.filterable and field.choices:
            return field.name, tuple(field.choices)
    return None


def _import_runs(world: World) -> None:
    """One row per run of the import wizard, and every number in it true (§29).

    The first version of this was wrong in five ways at once, and building
    `/import` found all five. It drew `valid = total - invalid` beside a
    separate non-zero `skipped`, so three of the four counts could not all be
    right. It gave every run the same five column names — `code, name, email,
    country, segment` — whatever it was importing into, and mapped four of them
    onto fields `order` and `task` do not have, so the page could not describe
    a single seeded run. It drew up to 25,000 rows, well past what one import
    may carry. Its errors cited an `email` column on datasets with no email.
    And a DRAFT run had no staged rows, so resuming one showed an empty wizard
    — the state the whole flow exists to support.

    So the columns are derived from the target's own writable declarations, the
    counts are computed from staged rows that exist, and an open run carries
    the file it is in the middle of.
    """
    from src.core import importer
    from src.models.platform import ImportRun
    from src.services.records import explorer

    rng = world.rng.derive("imports")
    # Only datasets that can be created, from the registry: a seeded run
    # naming something the API cannot import into is a row the page has to
    # apologise for.
    targets = [
        resource
        for _key, resource in sorted(explorer.resources().items())
        if resource.identity is not None
    ]
    if not targets:  # pragma: no cover - the registry always has some
        return

    for index in range(world.scale.import_runs):
        resource = rng.pick(targets)
        status = rng.weighted(
            (("COMPLETED", 0.5), ("FAILED", 0.15), ("DRAFT", 0.15), ("VALIDATED", 0.12), ("RUNNING", 0.08))
        )
        # A real spreadsheet's worth, and inside the wizard's own cap: every
        # row lives in JSONB and is rewritten on each mapping change.
        total = rng.integer(20, min(400, importer.MAX_ROWS))
        columns, mapping = _import_columns(rng, resource)
        open_run = status in ("DRAFT", "VALIDATED")
        # An open run holds the file it is in the middle of, and its total *is*
        # what it holds: two independent numbers let a draft claim four hundred
        # rows and stage sixty, which the preview footer would then have
        # described wrongly.
        rows = _import_rows(rng, columns, min(total, 60)) if open_run else None
        if rows is not None:
            total = len(rows)

        invalid = rng.integer(0, max(1, total // 8))
        skipped = rng.integer(0, max(1, total // 20))
        valid = total - invalid - skipped
        imported = valid if status == "COMPLETED" else 0

        world.import_runs.append(
            ImportRun(
                id=rng.uuid(),
                reference=reference("IMP", index + 1, width=6),
                target_entity=resource.key,
                filename=f"{resource.key}s-{rng.integer(2024, 2026)}-{rng.integer(1, 12):02d}.csv",
                status=status,
                step={"DRAFT": "MAPPING", "VALIDATED": "PREVIEW", "RUNNING": "EXECUTE"}.get(status, "DONE"),
                delimiter=rng.pick((",", ";")),
                total_rows=total,
                # A DRAFT has been read but not validated, so its outcome
                # counts are not yet facts about anything.
                valid_rows=0 if status == "DRAFT" else valid,
                invalid_rows=0 if status == "DRAFT" else invalid,
                skipped_rows=0 if status == "DRAFT" else skipped,
                imported_rows=imported,
                detected_columns=columns,
                column_mapping=mapping,
                # Cited against a column that is actually in the file and a
                # field that is actually mapped, in the shape `/import` reads.
                errors=_import_errors(rng, mapping, total, invalid)
                if status != "DRAFT"
                else None,
                # An open run is one somebody is in the middle of, so it holds
                # the file. A finished one does not: the rows have become
                # records, and keeping the spreadsheet as well would be holding
                # the data twice.
                staged_rows=rows,
                created_by_id=rng.pick(world.users).id if world.users else None,
                completed_at=rng.recent(days=20) if status in ("COMPLETED", "FAILED") else None,
                created_at=rng.recent(days=40),
            )
        )
