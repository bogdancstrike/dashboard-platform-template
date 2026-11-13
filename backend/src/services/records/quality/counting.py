"""Counting findings per check and dataset."""

from __future__ import annotations

from sqlalchemy import Select

from src.core.query import apply_filters
from src.services.records.explorer import Resource
from src.services.records.quality.checks import Check


def _statement(check: Check, resource: Resource) -> Select:
    """The rows a check finds, through the list's own filters where it can be.

    `_base_statement` is the explorer's, so the soft-delete rule is the one
    every list already applies — a quality report that counted deleted records
    would report problems nobody can open.
    """
    from src.services.records.explorer import _base_statement

    statement = _base_statement(resource)
    if check.predicate is not None:
        return statement.where(check.predicate(resource))
    return apply_filters(statement, dict(check.filters), resource.fields)


def _link(resource: Resource, check: Check) -> str:
    """The list, narrowed to exactly the rows the count found.

    `f.` prefixed, which is how the entity pages carry a filter in the URL — so
    this is the address a reader would have typed, and the page that opens is
    the page they already know.
    """
    parts = [f"f.{name}={value}" for name, value in sorted(check.filters.items())]
    return f"{resource.path}?{'&'.join(parts)}" if parts else resource.path
