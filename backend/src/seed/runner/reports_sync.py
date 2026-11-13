"""Repairing saved reports."""

from __future__ import annotations


def sync_reports(session) -> dict[str, int]:
    """Rewrite saved reports whose definition the compiler would reject.

    Not part of a seed run. This is what an *existing* database needs: every
    report seeded before the generator derived its columns from the resource
    declarations names a column or an aggregation that does not exist, and
    seeding refuses to touch a populated database — rightly, but that leaves
    the rows there.

    The repair is the smallest one that makes the question answerable: keep the
    groupings and measures that are valid, drop the rest, and fall back to the
    dataset's first groupable column and a row count if nothing survives. A
    report whose *name* says "by region" and whose dataset has no region is
    going to read oddly either way; a report that errors reads worse, and the
    name is a person's words to change, not this function's.

    Idempotent, so it can be run on every deploy.
    """
    from sqlalchemy import select as _select

    from src.models.personal import Report
    from src.services.analytics.analysis import (
        AGGREGATIONS,
        DIMENSION_KINDS,
        MEASURE_KINDS,
    )
    from src.services.records.explorer import resources

    catalogue = resources()
    repaired = 0
    orphaned = 0

    for row in session.scalars(_select(Report).where(Report.deleted_at.is_(None))):
        resource = catalogue.get(row.resource_type)
        if resource is None:
            # Nothing to repair it *to*: the dataset it reports on is gone.
            orphaned += 1
            continue

        groupable = [
            field.name
            for field in resource.fields.fields
            if field.kind in DIMENSION_KINDS and field.filterable and field.kind != "datetime"
        ]
        measurable = {
            field.name for field in resource.fields.fields if field.kind in MEASURE_KINDS
        }

        dimensions = [
            str(entry)
            for entry in (row.dimensions or [])
            if str(entry).partition(":")[0] in groupable
        ][:2]
        if not dimensions and groupable:
            dimensions = [groupable[0]]

        metrics = []
        for entry in row.metrics or []:
            aggregation, _, field = str(entry).partition(":")
            if aggregation not in AGGREGATIONS:
                continue
            if aggregation == "count":
                metrics.append("count")
            elif field in measurable:
                metrics.append(f"{aggregation}:{field}")
        if not metrics:
            metrics = ["count"]

        group_by = dimensions[0].partition(":")[0] if dimensions else None
        sort = metrics[0].partition(":")[0]
        if (
            list(row.dimensions or []) == dimensions
            and list(row.metrics or []) == metrics
            and row.group_by == group_by
            and row.sort == sort
        ):
            continue

        # Reassigned rather than mutated: an ARRAY column changed in place is
        # not seen as dirty by SQLAlchemy, and the UPDATE never happens.
        row.dimensions = dimensions
        row.metrics = metrics
        row.group_by = group_by
        row.sort = sort
        repaired += 1

    return {"repaired": repaired, "orphaned": orphaned}
