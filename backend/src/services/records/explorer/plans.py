"""Export plans: the statement and columns an export will read, decided up front."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import Select

from src.core.errors import ValidationError
from src.core.pagination import parse_page
from src.core.query import apply_filters, apply_sort
from src.core.rules import compile_tree, describe_tree
from src.services.records.explorer.model import Resource
from src.services.records.explorer.querying import (
    EXPORT_PERMISSION,
    _base_statement,
    _columns,
    _query_args,
)
from src.services.records.explorer.registry import resource_for


@dataclass(frozen=True, slots=True)
class Plan:
    """A validated export question, in a form a database row can hold (§30).

    An export that is small enough to stream is answered inside the request; one
    that is not becomes a background job, and the job has to be able to build
    *the same query* minutes later from a JSONB column. A plan is that column's
    content: every part of the question, normalised, and nothing that cannot
    survive `json.dumps`.

    What is deliberately **not** here is who asked. A permission set frozen into
    a row is a stale grant — it would still be true after the person lost the
    privilege — so authorisation happens when the plan is made and again when
    the file is fetched, never from the plan itself.
    """

    resource_type: str
    fmt: str
    columns: tuple[str, ...]
    filters: dict[str, Any]
    query_text: str
    condition_tree: dict[str, Any] | None
    sort: str
    order: str

    def stored(self) -> dict[str, Any]:
        """The plan as a job payload. Round-trips through `replan`."""
        return {
            "resource_type": self.resource_type,
            "format": self.fmt,
            "columns": list(self.columns),
            "filters": dict(self.filters),
            "query_text": self.query_text,
            "condition_tree": self.condition_tree,
            "sort": self.sort,
            "order": self.order,
        }

    @property
    def resource(self) -> Resource:
        return resource_for(self.resource_type)

    def describe(self) -> str:
        """What this export is, in a sentence somebody can read in a list."""
        resource = self.resource
        parts = [resource.label]
        narrowed = describe_tree(self.condition_tree, resource.fields)
        if self.query_text:
            parts.append(f'matching "{self.query_text}"')
        if narrowed:
            parts.append(f"where {narrowed}")
        elif self.filters:
            named = ", ".join(sorted(self.filters))
            parts.append(f"filtered by {named}")
        return " ".join(parts)


def plan_for(payload: dict[str, Any], *, principal) -> Plan:
    """Validate and authorise an export request. The only way to make a plan."""
    plan = _plan(payload)
    resource_for(plan.resource_type, principal=principal)
    principal.require(EXPORT_PERMISSION)
    return plan


def replan(stored: dict[str, Any] | None) -> Plan:
    """Rebuild a plan that was authorised when it was stored.

    Re-validated rather than trusted: a column can be removed from a resource
    between queueing an export and running it, and a plan naming a field that
    no longer exists must fail as a bad request rather than as a 500 inside a
    background job.
    """
    if not isinstance(stored, dict):
        raise ValidationError("That export has no query recorded on it.")
    return _plan(stored)


def _plan(payload: dict[str, Any]) -> Plan:
    from src.core import export as writer

    if not isinstance(payload, dict):
        raise ValidationError("The query must be a JSON object.")
    resource = resource_for(payload.get("resource_type"))
    page = parse_page(payload, default_sort=resource.default_sort)
    args = _query_args(payload)
    tree = payload.get("condition_tree")
    # Compiled here and thrown away: a tree that cannot compile is a bad
    # request, and finding that out when the file is being written is finding
    # it out too late.
    compile_tree(tree, resource.fields)

    return Plan(
        resource_type=resource.key,
        fmt=writer.parse_format(payload.get("format")),
        columns=tuple(_columns(payload.get("columns"), resource)),
        filters={key: value for key, value in args.items() if key != "q"},
        query_text=str(args.get("q") or ""),
        condition_tree=tree if isinstance(tree, dict) and tree else None,
        sort=page.sort,
        order=page.order,
    )


def statement_of(plan: Plan) -> Select:
    """The rows a plan asks for, unpaged.

    Shared by the streamed download and the background job so the two cannot
    drift: an export that queued because it was large must be the same question
    as the one that would have streamed had it been small.
    """
    resource = plan.resource
    args = dict(plan.filters)
    if plan.query_text:
        args["q"] = plan.query_text

    statement = apply_filters(_base_statement(resource), args, resource.fields)
    predicate = compile_tree(plan.condition_tree, resource.fields)
    if predicate is not None:
        statement = statement.where(predicate)
    page = parse_page({"sort": plan.sort, "order": plan.order}, default_sort=resource.default_sort)
    return apply_sort(statement, page, resource.fields, default=resource.default_sort)


def statement_for(payload: dict[str, Any], *, principal) -> Select:
    """The rows a question names, unpaged, for a caller that is not exporting.

    The same query the list ran, reached through the same validation — which is
    what makes "everything matching this filter" (§43) mean exactly what the
    reader was looking at. A second filter implementation for bulk is a second
    place for "case-insensitive" to be decided differently, and the first time
    the two disagreed somebody would have changed rows they never saw.

    Authorised as a *read*, because naming rows is reading them; whether the
    caller may then write to them is the bulk service's question.

    It goes through `Plan`, which also carries a format and a column list that
    a selection has no use for; both default harmlessly. Building the statement
    a second way to avoid two unused fields would be trading a cosmetic
    duplication for the one that matters.
    """
    resource_for(payload.get("resource_type"), principal=principal)
    return statement_of(_plan(payload))
