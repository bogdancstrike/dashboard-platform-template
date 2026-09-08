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

from sqlalchemy import Numeric, Select, cast as sql_cast, func, select

from src.core import vocabulary
from src.core.errors import ValidationError
from src.core.pagination import envelope, parse_page
from src.core.query import Field, FieldSet, apply_filters, apply_sort, count_of, facets_for
from src.core.rules import compile_tree, describe_tree, rule_count


#: Reading a dataset and taking a copy of it away are different privileges.
EXPORT_PERMISSION = "records.export"


@dataclass(frozen=True, slots=True)
class Metric:
    """One headline number a dataset can answer about itself.

    Declared beside the fields rather than computed in a page, for the same
    reason the field catalogue is: a number a screen works out for itself is a
    second definition of it, and the two disagree the first time somebody
    changes what "open" means.
    """

    key: str
    label: str
    #: `count` · `sum` · `avg` · `share` — `share` is the percentage of rows
    #: matching `equals`, which is how "SLA breached" and "overdue" are asked.
    kind: str = "count"
    #: The field aggregated. Required for `sum` and `avg`.
    field: str = ""
    #: For `count` and `share`: restrict to rows whose `field` is one of these.
    equals: tuple[str, ...] = ()
    #: How the client should render it: `number` · `currency` · `percent` ·
    #: `hours`. A formatting hint, not a unit conversion.
    format: str = "number"
    hint: str = ""


@dataclass(frozen=True, slots=True)
class Insight:
    """What a dataset can say about the rows currently in view.

    Three shapes, because three questions are worth answering above a list:
    *how much* (metrics), *of what kinds* (breakdowns) and *going which way*
    (a trend). Anything more specific belongs on a report.
    """

    metrics: tuple[Metric, ...] = ()
    #: Faceted fields worth charting rather than only filtering by.
    breakdowns: tuple[str, ...] = ()
    #: The date field a time series is drawn over, when one makes sense.
    trend: str = ""
    #: Aggregated alongside the trend, when the dataset has money or effort in
    #: it. Empty means the trend counts rows.
    trend_value: str = ""


@dataclass(frozen=True, slots=True)
class Writable:
    """One field a create or edit form may write, and the limits on it.

    Deliberately a *second* declaration rather than a flag on :class:`Field`:
    what a column can be filtered by and what a form may put into it are two
    different questions, and answering both from one place is how a dataset
    ends up accidentally editable because somebody wanted to sort by it.

    Everything a form needs to *render* the control — label, kind, choices —
    still comes from the `Field`, so a writable field cannot describe itself
    differently from the way the same field is filtered.
    """

    name: str
    #: Refused as empty on create. An edit may still omit it entirely; what it
    #: may not do is blank it.
    required: bool = False
    #: Inclusive bounds for number fields, enforced server-side. A percentage
    #: column that accepts 400 is a chart with a bar off the top of the panel.
    minimum: float | None = None
    maximum: float | None = None


@dataclass(frozen=True, slots=True)
class Identity:
    """The human-readable identifier a created record is given.

    Generated, never accepted from the client: `TSK-00042` is the string people
    quote to each other, and a form that lets two of them be typed produces two
    records nobody can tell apart in a sentence.
    """

    field: str
    prefix: str
    width: int = 5


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
    #: The route the entity pages live under — `/tickets`, `/customers`.
    #: Plural because that is what a list is, and a URL is read by people.
    route: str = ""
    #: Which field names a record on its own detail page, which one identifies
    #: it in a sentence, and which one carries its state. Declared rather than
    #: guessed: a heading that reads "a1f3c8de-…" is a heading nobody can use.
    title_field: str = "name"
    subtitle_field: str = ""
    status_field: str = "status"
    #: Long-form fields read as document sections in record previews. Explicit
    #: opt-in keeps a new database column from becoming public by accident.
    content_fields: tuple[str, ...] = ()
    #: What this dataset can say about itself above a list (§44).
    insight: Insight = Insight()
    #: The fields a form may write (§9). Empty means the dataset is read-only,
    #: and the API says so rather than silently ignoring a payload.
    editable: tuple[Writable, ...] = ()
    #: How a created record is named. Absent means the dataset cannot be
    #: created through the API, only edited.
    identity: Identity | None = None

    @property
    def writable(self) -> dict[str, Writable]:
        """The write declarations by field name, for validation and for the
        catalogue the form is rendered from."""
        return {spec.name: spec for spec in self.editable}

    def writability(self, name: str) -> dict[str, Any]:
        """What a form may do with one field (§9).

        Carried *on* the field wherever fields are published rather than in a
        list beside them: a form renders the fields it is given, and a separate
        "editable" array is a second place for the two to disagree about which
        field `progress` is.
        """
        spec = self.writable.get(name)
        if spec is None:
            return {"editable": False}
        field = self.fields.by_name.get(name)
        return {
            "editable": True,
            "required": spec.required,
            "minimum": spec.minimum,
            "maximum": spec.maximum,
            # What a foreign key points at, so a form renders a picker for it
            # rather than a box somebody has to paste a UUID into. Read off the
            # column's own ForeignKey, so a new relation gets its picker the
            # day it is declared.
            "references": references_of(field) if field else "",
        }

    @property
    def path(self) -> str:
        return self.route or f"/{self.key}s"

    def label_for(self, row: Any) -> str:
        """What to call one record, in one place, so every screen agrees."""
        for name in (self.title_field, self.subtitle_field, "reference", "code", "name"):
            value = getattr(row, name, None) if name else None
            if value:
                return str(value)
        return str(getattr(row, "id", ""))


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
                # The card's to-do list (§18). Declared so it travels with the
                # record and can be written by the same endpoint everything
                # else is; ticking an item is an edit to the task, not a
                # second kind of write with a second set of rules.
                Field("checklist", Task.checklist, kind="json", filterable=False,
                      sortable=False),
                *_common(Task),
            ),
            ("reference", "title", "status", "priority", "due_date", "progress", "updated_at"),
            route="/tasks", title_field="title", subtitle_field="reference",
            content_fields=("description",),
            insight=Insight(
                metrics=(
                    Metric("total", "Work items"),
                    Metric("in_progress", "In progress", field="status",
                           equals=("IN_PROGRESS", "IN_REVIEW")),
                    Metric("logged", "Hours logged", kind="sum", field="logged_hours",
                           format="hours"),
                    Metric("progress", "Average progress", kind="avg", field="progress",
                           format="percent"),
                ),
                breakdowns=("status", "priority", "kind"),
                trend="created_at",
            ),
            editable=(
                Writable("title", required=True),
                Writable("description"),
                Writable("status"),
                Writable("priority"),
                Writable("kind"),
                Writable("due_date"),
                Writable("progress", minimum=0, maximum=100),
                Writable("estimate_hours", minimum=0, maximum=10_000),
                Writable("logged_hours", minimum=0, maximum=10_000),
                Writable("assignee_id"),
                Writable("project_id"),
                Writable("checklist"),
            ),
            identity=Identity("reference", "TSK"),
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
                # The moments a support desk is measured on, declared so the
                # ticket console reads them from the record rather than from a
                # second endpoint that would know them differently.
                Field("first_response_at", Ticket.first_response_at, kind="datetime",
                      label="First response"),
                Field("resolved_at", Ticket.resolved_at, kind="datetime", label="Resolved"),
                Field("reopen_count", Ticket.reopen_count, kind="number", label="Reopens"),
                Field("satisfaction", Ticket.satisfaction, kind="number"),
                Field("assignee_id", Ticket.assignee_id, kind="uuid", label="Assignee ID"),
                Field("customer_id", Ticket.customer_id, kind="uuid", label="Customer ID"),
                Field("project_id", Ticket.project_id, kind="uuid", label="Project ID"),
                *_common(Ticket),
            ),
            ("reference", "subject", "status", "priority", "severity", "due_at", "sla_breached"),
            route="/tickets", title_field="subject", subtitle_field="reference",
            content_fields=("description",),
            insight=Insight(
                metrics=(
                    Metric("total", "Tickets"),
                    Metric("open", "Open", field="status",
                           equals=("OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER",
                                   "ESCALATED")),
                    Metric("breached", "SLA breached", kind="share", field="sla_breached",
                           equals=("true",), format="percent"),
                    Metric("resolution", "Mean resolution", kind="avg",
                           field="resolution_minutes", format="minutes"),
                ),
                breakdowns=("severity", "status", "category", "channel"),
                trend="created_at",
            ),
            editable=(
                Writable("subject", required=True),
                Writable("description"),
                Writable("status"),
                Writable("priority"),
                Writable("severity"),
                Writable("category"),
                Writable("channel"),
                Writable("due_at"),
                Writable("sla_breached"),
                Writable("assignee_id"),
                # A mis-filed ticket is re-pointed at the right account, which
                # is an everyday support action rather than an administrative
                # one; the moments above are consequences and stay read-only.
                Writable("customer_id"),
                Writable("project_id"),
            ),
            identity=Identity("reference", "TIC"),
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
                Field("completed_at", Project.completed_at, kind="datetime", label="Completed"),
                Field("budget", Project.budget, kind="number"),
                Field("spent", Project.spent, kind="number"),
                Field("currency", Project.currency, kind="enum", facet=True,
                      choices=vocabulary.CURRENCY),
                Field("progress", Project.progress, kind="number"),
                Field("owner_id", Project.owner_id, kind="uuid", label="Owner ID"),
                Field("customer_id", Project.customer_id, kind="uuid", label="Customer ID"),
                *_common(Project),
            ),
            ("code", "name", "status", "health", "priority", "progress", "due_date"),
            route="/projects", title_field="name", subtitle_field="code",
            content_fields=("description",),
            insight=Insight(
                metrics=(
                    Metric("total", "Projects"),
                    Metric("at_risk", "At risk", field="health", equals=("AT_RISK", "OFF_TRACK")),
                    Metric("budget", "Budget", kind="sum", field="budget", format="currency"),
                    Metric("spent", "Spent", kind="sum", field="spent", format="currency"),
                ),
                breakdowns=("health", "phase", "status"),
                trend="start_date",
                trend_value="budget",
            ),
            editable=(
                Writable("name", required=True),
                Writable("description"),
                Writable("status"),
                Writable("phase"),
                Writable("priority"),
                Writable("health"),
                Writable("start_date"),
                Writable("due_date"),
                Writable("budget", minimum=0),
                Writable("spent", minimum=0),
                Writable("currency"),
                Writable("progress", minimum=0, maximum=100),
                Writable("owner_id"),
                Writable("customer_id"),
            ),
            identity=Identity("code", "PRJ", width=4),
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
            route="/customers", title_field="name", subtitle_field="code",
            insight=Insight(
                metrics=(
                    Metric("total", "Accounts"),
                    Metric("active", "Active", field="status", equals=("ACTIVE",)),
                    Metric("value", "Lifetime value", kind="sum", field="lifetime_value",
                           format="currency"),
                    Metric("satisfaction", "Satisfaction", kind="avg", field="satisfaction",
                           format="score"),
                ),
                breakdowns=("segment", "lifecycle_stage", "industry", "country"),
                trend="created_at",
                trend_value="lifetime_value",
            ),
            editable=(
                Writable("name", required=True),
                Writable("email"),
                Writable("status"),
                Writable("segment"),
                Writable("industry"),
                Writable("lifecycle_stage"),
                Writable("country"),
                Writable("city"),
                Writable("lifetime_value", minimum=0),
                Writable("satisfaction", minimum=0, maximum=10),
                Writable("last_contact_at"),
                Writable("account_manager_id"),
            ),
            identity=Identity("code", "CUS"),
        ),
        "order": Resource(
            "order", "Orders", "Commercial transactions, fulfilment and payment state.", Order,
            FieldSet(
                Field("reference", Order.reference, searchable=True, label="Reference"),
                Field("notes", Order.notes, searchable=True),
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
            route="/orders", title_field="reference",
            content_fields=("notes",),
            insight=Insight(
                metrics=(
                    Metric("total", "Orders"),
                    Metric("revenue", "Revenue", kind="sum", field="total", format="currency"),
                    Metric("average", "Average order", kind="avg", field="total",
                           format="currency"),
                    Metric("unpaid", "Awaiting payment", field="payment_status",
                           equals=("UNPAID", "PARTIAL", "OVERDUE")),
                ),
                breakdowns=("status", "payment_status", "fulfilment_status", "channel"),
                trend="placed_at",
                trend_value="total",
            ),
            editable=(
                Writable("status"),
                Writable("payment_status"),
                Writable("fulfilment_status"),
                Writable("channel"),
                Writable("placed_at"),
                Writable("total", minimum=0),
                Writable("currency"),
                Writable("item_count", minimum=0, maximum=10_000),
                Writable("notes"),
                Writable("customer_id"),
            ),
            identity=Identity("reference", "ORD"),
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
            route="/devices", title_field="name", subtitle_field="serial",
            insight=Insight(
                metrics=(
                    Metric("total", "Devices"),
                    Metric("online", "Online", field="status", equals=("ONLINE",)),
                    Metric("battery", "Mean battery", kind="avg", field="battery_percent",
                           format="percent"),
                    Metric("errors", "Errors logged", kind="sum", field="error_count"),
                ),
                breakdowns=("status", "kind", "manufacturer", "location"),
                trend="last_seen_at",
            ),
            editable=(
                Writable("name", required=True),
                Writable("kind"),
                Writable("model"),
                Writable("manufacturer"),
                Writable("status"),
                Writable("location"),
                Writable("last_seen_at"),
                Writable("battery_percent", minimum=0, maximum=100),
                Writable("signal_strength", minimum=-120, maximum=0),
                Writable("uptime_hours", minimum=0),
                Writable("error_count", minimum=0),
            ),
            identity=Identity("serial", "DEV"),
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


#: Datasets that are pickable but not explorable. People have a directory of
#: their own (`/api/directory/people`), which is the business card a viewer is
#: allowed to see rather than the user administration record.
_PICKABLE_TABLES = {"users": "user"}


def references_of(field: Field) -> str:
    """Which dataset a foreign-key column points at, named as a picker wants it.

    Derived from the schema, never listed here: the column already carries its
    `ForeignKey`, and a second table-to-dataset mapping kept by hand is wrong
    the first time anybody adds a relation.
    """
    for key in getattr(field.column, "foreign_keys", set()) or set():
        table = key.column.table.name
        if table in _PICKABLE_TABLES:
            return _PICKABLE_TABLES[table]
        for resource in resources().values():
            if getattr(resource.model, "__tablename__", "") == table:
                return resource.key
    return ""


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
            "path": resource.path,
            "title_field": resource.title_field,
            "subtitle_field": resource.subtitle_field,
            "status_field": resource.status_field,
            "record_count": count_of(session, base),
            "default_columns": list(resource.default_columns),
            "default_sort": resource.default_sort,
            "fields": [
                {**described, **resource.writability(described["name"])}
                for described in resource.fields.describe()
            ],
            # A create form has no record to read this from, so the catalogue
            # carries it (§9, §76).
            "can_create": bool(resource.identity) and principal.can("records.create"),
            "can_edit": bool(resource.editable) and principal.can("records.update"),
            "can_delete": principal.can("records.delete"),
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


def columns_of(plan: Plan) -> list[Any]:
    """The file's header, labelled as the field catalogue labels it."""
    from src.core import export as writer

    fields = plan.resource.fields.by_name
    return [writer.Column(name, fields[name].title) for name in plan.columns]


def rows_of(plan: Plan, rows: Any) -> Any:
    """Each row as the file wants it: a generator, so nothing is accumulated."""
    resource = plan.resource
    names = list(plan.columns)
    return (_serialize(row, resource, names) for row in rows)


def export(payload: dict[str, Any], *, principal):
    """The current exploration as a file (§30).

    The same statement `run` builds, minus its page — so the download is
    provably the question on screen rather than a second, similar query that
    will drift from it. Not handed a session: the rows stream after this
    returns and open one of their own.
    """
    from src.core import export as writer

    plan = plan_for(payload, principal=principal)
    statement = statement_of(plan)
    # Counted before a byte is written: a download that stopped at the ceiling
    # used to arrive as a plausible-looking fragment with a 200 on it. Above the
    # ceiling this raises, and the message says to queue it instead (§30).
    writer.refuse_if_truncated(statement, fmt=plan.fmt, what=plan.resource.label.lower())
    rows = writer.stream_rows(statement, limit=writer.limit_for(plan.fmt))
    return writer.response(
        rows_of(plan, rows),
        columns_of(plan),
        fmt=plan.fmt,
        stem=plan.resource_type,
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


# ── insights (§44, §71) ──────────────────────────────────────────────────

#: Buckets in a trend. Enough to see a shape, few enough to read the axis.
TREND_BUCKETS = 30
#: Values per breakdown before the tail is dropped. A pie with forty slices is
#: a colour wheel.
BREAKDOWN_LIMIT = 8


def insights(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """What a dataset says about the rows the reader is currently looking at.

    Deliberately the *same* filters as the list beside it. A summary computed
    over the whole table while the table below shows a filtered slice is two
    answers to one question, and the reader has no way to tell which is which —
    so this takes the identical payload `run` takes and applies it identically.

    Everything is aggregated in PostgreSQL. Summing a page of twenty-five rows
    in the browser gives "revenue: 41 000" for a dataset holding four million,
    which is not a smaller version of the right answer but a wrong one.

    What is returned is decided by the `Insight` declared on the resource, so
    adding a headline number to a dataset is a declaration rather than an
    endpoint and a page.
    """
    if not isinstance(payload, dict):
        raise ValidationError("The query must be a JSON object.")
    resource = resource_for(payload.get("resource_type"), principal=principal)

    statement = apply_filters(_base_statement(resource), _query_args(payload), resource.fields)
    predicate = compile_tree(payload.get("condition_tree"), resource.fields)
    if predicate is not None:
        statement = statement.where(predicate)

    scope = statement.subquery()
    declared = resource.insight

    return {
        "resource_type": resource.key,
        "total": count_of(session, statement),
        "metrics": [_metric(session, scope, resource, metric) for metric in declared.metrics],
        "breakdowns": [
            _breakdown(session, scope, resource, name)
            for name in declared.breakdowns
            if name in resource.fields.by_name
        ],
        "trend": _trend(session, scope, resource, declared),
    }


def _column_of(scope, resource: Resource, name: str):
    """The declared field's column, as it exists on the filtered subquery."""
    field = resource.fields.by_name.get(name)
    if field is None:
        raise ValidationError("Unknown field.", details={"field": name})
    return scope.c[field.column.key]


def _metric(session, scope, resource: Resource, metric: Metric) -> dict[str, Any]:
    """One headline number, computed over the filtered set."""
    value: float
    if metric.kind in ("sum", "avg") and metric.field:
        column = _column_of(scope, resource, metric.field)
        aggregate = func.sum if metric.kind == "sum" else func.avg
        value = float(session.scalar(select(aggregate(sql_cast(column, Numeric))).select_from(scope)) or 0)
    else:
        statement = select(func.count()).select_from(scope)
        matched = statement
        if metric.field and metric.equals:
            column = _column_of(scope, resource, metric.field)
            matched = statement.where(_matches(column, metric.equals))
        counted = float(session.scalar(matched) or 0)
        if metric.kind == "share":
            # A share of nothing is zero rather than a division by zero, and
            # zero is the honest answer: no rows breached because no rows.
            everything = float(session.scalar(statement) or 0)
            value = round(100 * counted / everything, 1) if everything else 0.0
        else:
            value = counted

    return {
        "key": metric.key,
        "label": metric.label,
        "value": round(value, 2),
        "format": metric.format,
        "hint": metric.hint,
        # The filter that reproduces the number, so a tile can be clicked
        # through to the rows behind it (§44).
        "filter": (
            {metric.field: list(metric.equals)} if metric.field and metric.equals else {}
        ),
    }


def _matches(column, values: tuple[str, ...]):
    """`equals` as SQL, coping with the booleans a declaration spells as text."""
    if values in (("true",), ("false",)):
        return column.is_(values[0] == "true")
    return column.in_(list(values))


def _breakdown(session, scope, resource: Resource, name: str) -> dict[str, Any]:
    """One group-by, largest first, with the long tail collapsed."""
    column = _column_of(scope, resource, name)
    rows = session.execute(
        select(column.label("name"), func.count().label("value"))
        .select_from(scope)
        .group_by(column)
        .order_by(func.count().desc())
    ).all()

    head = rows[:BREAKDOWN_LIMIT]
    tail = sum(int(row.value) for row in rows[BREAKDOWN_LIMIT:])
    series = [{"name": str(row.name or "—"), "value": int(row.value)} for row in head]
    if tail:
        # Named rather than dropped: a chart whose slices do not add up to the
        # total is a chart nobody can reconcile with the list beside it.
        series.append({"name": f"{len(rows) - BREAKDOWN_LIMIT} others", "value": tail})

    field = resource.fields.by_name[name]
    return {"field": name, "label": field.title, "series": series, "distinct": len(rows)}


def _trend(session, scope, resource: Resource, declared: Insight) -> dict[str, Any] | None:
    """Rows — or their value — over time, bucketed by day.

    Only over the range the filtered set actually spans, so a dataset with two
    years of history and a filter selecting last week draws last week rather
    than a flat line with one spike at the end.
    """
    if not declared.trend or declared.trend not in resource.fields.by_name:
        return None

    column = _column_of(scope, resource, declared.trend)
    bucket = func.date_trunc("day", column).label("at")
    measure = func.count().label("value")
    if declared.trend_value and declared.trend_value in resource.fields.by_name:
        measure = func.sum(
            sql_cast(_column_of(scope, resource, declared.trend_value), Numeric)
        ).label("value")

    rows = session.execute(
        select(bucket, measure)
        .select_from(scope)
        .where(column.isnot(None))
        .group_by(bucket)
        .order_by(bucket.desc())
        .limit(TREND_BUCKETS)
    ).all()

    field = resource.fields.by_name[declared.trend]
    return {
        "field": declared.trend,
        "label": field.title,
        "measure": declared.trend_value or "count",
        # Reversed here rather than in the browser: a chart is drawn left to
        # right and the query has to end with a LIMIT on the newest.
        "series": [
            {"name": row.at.date().isoformat(), "value": float(row.value or 0)}
            for row in reversed(rows)
        ],
    }
