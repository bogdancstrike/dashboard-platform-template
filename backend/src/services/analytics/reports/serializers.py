"""Who sees a report, favourites, and a report as the API returns it."""

from __future__ import annotations

from src.models.personal import Report


def _stored_dimensions(row: Report) -> list[dict[str, str]]:
    """`["status", "placed_at:month"]` → the compiler's dimension objects.

    Stored as strings because the column is a text array, and a JSON blob for
    two fields would be a column nobody can index or read in psql.
    """
    out: list[dict[str, str]] = []
    for entry in row.dimensions or []:
        field, _, granularity = str(entry).partition(":")
        out.append({"field": field, "granularity": granularity})
    return out


def _stored_measures(row: Report) -> list[dict[str, str]]:
    """`["count", "sum:total"]` → the compiler's measure objects."""
    out: list[dict[str, str]] = []
    for entry in row.metrics or []:
        aggregation, _, field = str(entry).partition(":")
        out.append({"aggregation": aggregation, "field": field})
    return out
