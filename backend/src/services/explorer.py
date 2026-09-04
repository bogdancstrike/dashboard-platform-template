"""Reusable, server-side data exploration across platform record types.

One :class:`Resource` declaration is the source of truth for each dataset.  It
drives the field catalogue sent to the query builder, SQL filtering/sorting,
the default result columns and value serialization.  Adding another explorer
dataset is therefore a declaration, not a new endpoint and page.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from sqlalchemy import Select, select

from src.core import vocabulary
from src.core.errors import ValidationError
from src.core.pagination import envelope, parse_page
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for
from src.core.rules import compile_tree, describe_tree, rule_count


@dataclass(frozen=True, slots=True)
class Resource:
    """Everything the generic explorer needs to expose one ORM entity."""

    key: str
    label: str
    description: str
    model: type
    fields: FieldSet
    default_columns: tuple[str, ...]
    default_sort: str = "updated_at"
    permission: str = "records.view"


def _common(model) -> tuple[Field, ...]:
    return (
        Field("id", model.id, kind="uuid", label="ID"),
        Field("created_at", model.created_at, kind="datetime", label="Created"),
        Field("updated_at", model.updated_at, kind="datetime", label="Updated"),
    )


def _resources() -> dict[str, Resource]:
    """Build lazily so importing this module does not pull every model at boot."""
    from src.models.business import Customer, Device, Order, Project, Task, Ticket

    return {
        "task": Resource(
            "task", "Tasks", "Work items, ownership, priority and delivery state.", Task,
            FieldSet(
                Field("reference", Task.reference, searchable=True, label="Reference"),
                Field("title", Task.title, searchable=True),
                Field("description", Task.description, searchable=True),
                Field("status", Task.status, kind="enum", facet=True,
                      choices=vocabulary.TASK_STATUS),
                Field("priority", Task.priority, kind="enum", facet=True,
                      choices=vocabulary.PRIORITY),
                Field("kind", Task.kind, kind="enum", facet=True,
                      choices=vocabulary.TASK_KIND),
                Field("due_date", Task.due_date, kind="datetime", label="Due date"),
                Field("progress", Task.progress, kind="number"),
                Field("estimate_hours", Task.estimate_hours, kind="number", label="Estimate (hours)"),
                Field("logged_hours", Task.logged_hours, kind="number", label="Logged (hours)"),
                Field("assignee_id", Task.assignee_id, kind="uuid", label="Assignee ID"),
                Field("project_id", Task.project_id, kind="uuid", label="Project ID"),
                *_common(Task),
            ),
            ("reference", "title", "status", "priority", "due_date", "progress", "updated_at"),
        ),
        "ticket": Resource(
            "ticket", "Tickets", "Support demand, SLA health, severity and ownership.", Ticket,
            FieldSet(
                Field("reference", Ticket.reference, searchable=True, label="Reference"),
                Field("subject", Ticket.subject, searchable=True),
                Field("description", Ticket.description, searchable=True),
                Field("status", Ticket.status, kind="enum", facet=True,
                      choices=vocabulary.TICKET_STATUS),
                Field("priority", Ticket.priority, kind="enum", facet=True,
                      choices=vocabulary.PRIORITY),
                Field("severity", Ticket.severity, kind="enum", facet=True,
                      choices=vocabulary.SEVERITY),
                Field("category", Ticket.category, kind="enum", facet=True,
                      choices=vocabulary.TICKET_CATEGORY),
                Field("channel", Ticket.channel, kind="enum", facet=True,
                      choices=vocabulary.TICKET_CHANNEL),
                Field("due_at", Ticket.due_at, kind="datetime", label="Due"),
                Field("sla_breached", Ticket.sla_breached, kind="bool", label="SLA breached"),
                Field("resolution_minutes", Ticket.resolution_minutes, kind="number"),
                Field("assignee_id", Ticket.assignee_id, kind="uuid", label="Assignee ID"),
                *_common(Ticket),
            ),
            ("reference", "subject", "status", "priority", "severity", "due_at", "sla_breached"),
        ),
        "project": Resource(
            "project", "Projects", "Portfolio delivery, budget, progress and health.", Project,
            FieldSet(
                Field("code", Project.code, searchable=True),
                Field("name", Project.name, searchable=True),
                Field("description", Project.description, searchable=True),
                Field("status", Project.status, kind="enum", facet=True,
                      choices=vocabulary.PROJECT_STATUS),
                Field("phase", Project.phase, kind="enum", facet=True,
                      choices=vocabulary.PROJECT_PHASE),
                Field("priority", Project.priority, kind="enum", facet=True,
                      choices=vocabulary.PRIORITY),
                Field("health", Project.health, kind="enum", facet=True,
                      choices=vocabulary.PROJECT_HEALTH),
                Field("start_date", Project.start_date, kind="datetime"),
                Field("due_date", Project.due_date, kind="datetime"),
                Field("budget", Project.budget, kind="number"),
                Field("spent", Project.spent, kind="number"),
                Field("progress", Project.progress, kind="number"),
                Field("owner_id", Project.owner_id, kind="uuid", label="Owner ID"),
                *_common(Project),
            ),
            ("code", "name", "status", "health", "priority", "progress", "due_date"),
        ),
        "customer": Resource(
            "customer", "Customers", "Accounts, lifecycle, value and relationship health.", Customer,
            FieldSet(
                Field("code", Customer.code, searchable=True),
                Field("name", Customer.name, searchable=True),
                Field("email", Customer.email, searchable=True),
                Field("status", Customer.status, kind="enum", facet=True,
                      choices=vocabulary.CUSTOMER_STATUS),
                Field("segment", Customer.segment, kind="enum", facet=True,
                      choices=vocabulary.CUSTOMER_SEGMENT),
                Field("industry", Customer.industry, facet=True),
                Field("lifecycle_stage", Customer.lifecycle_stage, kind="enum", facet=True,
                      choices=vocabulary.LIFECYCLE_STAGE, label="Lifecycle stage"),
                Field("country", Customer.country, facet=True),
                Field("city", Customer.city, searchable=True),
                Field("lifetime_value", Customer.lifetime_value, kind="number"),
                Field("satisfaction", Customer.satisfaction, kind="number"),
                Field("last_contact_at", Customer.last_contact_at, kind="datetime"),
                Field("account_manager_id", Customer.account_manager_id, kind="uuid", label="Account manager ID"),
                *_common(Customer),
            ),
            ("code", "name", "status", "segment", "industry", "lifetime_value", "last_contact_at"),
        ),
        "order": Resource(
            "order", "Orders", "Commercial transactions, fulfilment and payment state.", Order,
            FieldSet(
                Field("reference", Order.reference, searchable=True, label="Reference"),
                Field("status", Order.status, kind="enum", facet=True,
                      choices=vocabulary.ORDER_STATUS),
                Field("payment_status", Order.payment_status, kind="enum", facet=True,
                      choices=vocabulary.PAYMENT_STATUS, label="Payment status"),
                Field("fulfilment_status", Order.fulfilment_status, kind="enum", facet=True,
                      choices=vocabulary.FULFILMENT_STATUS, label="Fulfilment status"),
                Field("channel", Order.channel, kind="enum", facet=True,
                      choices=vocabulary.ORDER_CHANNEL),
                Field("placed_at", Order.placed_at, kind="datetime"),
                Field("total", Order.total, kind="number"),
                Field("currency", Order.currency, kind="enum", facet=True,
                      choices=vocabulary.CURRENCY),
                Field("item_count", Order.item_count, kind="number"),
                Field("customer_id", Order.customer_id, kind="uuid", label="Customer ID"),
                *_common(Order),
            ),
            ("reference", "status", "payment_status", "fulfilment_status", "channel", "total", "placed_at"),
            default_sort="placed_at",
        ),
        "device": Resource(
            "device", "Devices", "Managed hardware, telemetry and operational health.", Device,
            FieldSet(
                Field("serial", Device.serial, searchable=True),
                Field("name", Device.name, searchable=True),
                Field("kind", Device.kind, kind="enum", facet=True,
                      choices=vocabulary.DEVICE_KIND),
                Field("model", Device.model, searchable=True),
                Field("manufacturer", Device.manufacturer, searchable=True, facet=True),
                Field("status", Device.status, kind="enum", facet=True,
                      choices=vocabulary.DEVICE_STATUS),
                Field("location", Device.location, searchable=True, facet=True),
                Field("last_seen_at", Device.last_seen_at, kind="datetime"),
                Field("battery_percent", Device.battery_percent, kind="number"),
                Field("signal_strength", Device.signal_strength, kind="number"),
                Field("uptime_hours", Device.uptime_hours, kind="number"),
                Field("error_count", Device.error_count, kind="number"),
                *_common(Device),
            ),
            ("serial", "name", "kind", "status", "location", "battery_percent", "last_seen_at"),
            default_sort="last_seen_at",
        ),
    }


def resources() -> dict[str, Resource]:
    """Public registry accessor; returned declarations are immutable."""
    return _resources()


def resource_for(key: Any, *, principal=None) -> Resource:
    resource = resources().get(str(key or ""))
    if resource is None:
        raise ValidationError(
            "Unknown explorer resource.",
            details={"resource_type": str(key or ""), "available": sorted(resources())},
        )
    if principal is not None:
        principal.require(resource.permission)
    return resource


def catalogue(session, *, principal) -> dict[str, Any]:
    """Describe every dataset the caller may explore, including live counts."""
    items = []
    for resource in resources().values():
        if not principal.can(resource.permission):
            continue
        base = _base_statement(resource)
        items.append({
            "key": resource.key,
            "label": resource.label,
            "description": resource.description,
            "permission": resource.permission,
            "record_count": count_of(session, base),
            "default_columns": list(resource.default_columns),
            "default_sort": resource.default_sort,
            "fields": resource.fields.describe(),
        })
    return {"items": items, "view_modes": ["table", "list", "cards", "compact"]}


def run(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Execute a simple and/or nested query entirely in PostgreSQL."""
    if not isinstance(payload, dict):
        raise ValidationError("The query must be a JSON object.")
    resource = resource_for(payload.get("resource_type"), principal=principal)
    tree = payload.get("condition_tree")
    if tree is not None and not isinstance(tree, dict):
        raise ValidationError("condition_tree must be an object or null")

    page = parse_page(payload, default_sort=resource.default_sort)
    statement = apply_filters(_base_statement(resource), _query_args(payload), resource.fields)
    predicate = compile_tree(tree, resource.fields)
    if predicate is not None:
        statement = statement.where(predicate)

    total = count_of(session, statement)
    # One GROUP BY per faceted column, so it is asked for rather than assumed:
    # the explorer's filtering happens in the condition builder, and computing
    # menus nobody renders is work the reader waits for.
    facets = (
        facets_for(session, statement, resource.fields)
        if bool(payload.get("facets"))
        else {}
    )
    statement = apply_sort(statement, page, resource.fields, default=resource.default_sort)
    rows = session.scalars(statement.offset(page.offset).limit(page.page_size)).unique().all()
    columns = _columns(payload.get("columns"), resource)

    return envelope(
        [_serialize(row, resource, columns) for row in rows],
        total,
        page,
        resource_type=resource.key,
        columns=columns,
        fields=resource.fields.describe(),
        facets=facets,
        condition_text=describe_tree(tree, resource.fields),
        rule_count=rule_count(tree),
        # Echoed so the client highlights the term that was actually searched
        # for, not the one currently in the box: the two differ for as long as
        # the request is in flight, and highlighting the newer one marks
        # matches that are not there.
        query_text=str(payload.get("query_text") or "").strip(),
        searchable=[field.name for field in resource.fields.searchable],
    )


def _base_statement(resource: Resource) -> Select:
    statement = select(resource.model)
    deleted = getattr(resource.model, "deleted_at", None)
    return statement.where(deleted.is_(None)) if deleted is not None else statement


def _query_args(payload: dict[str, Any]) -> dict[str, Any]:
    filters = payload.get("filters") or {}
    if not isinstance(filters, dict):
        raise ValidationError("filters must be an object")
    out = dict(filters)
    if payload.get("query_text") not in (None, ""):
        out["q"] = payload["query_text"]
    return out


def _columns(raw: Any, resource: Resource) -> list[str]:
    if raw in (None, []):
        return list(resource.default_columns)
    if not isinstance(raw, list):
        raise ValidationError("columns must be an array")
    columns = list(dict.fromkeys(str(item) for item in raw))
    unknown = [name for name in columns if name not in resource.fields.by_name]
    if unknown:
        raise ValidationError("Unknown result column.", details={"columns": unknown})
    if not columns:
        raise ValidationError("At least one result column is required.")
    return columns[:30]


def _serialize(row: Any, resource: Resource, columns: list[str]) -> dict[str, Any]:
    item = {"id": str(row.id)}
    for name in columns:
        canonical = resource.fields.by_name[name].name
        item[canonical] = _json_value(getattr(row, canonical, None))
    return item


def _json_value(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, tuple):
        return list(value)
    return value
