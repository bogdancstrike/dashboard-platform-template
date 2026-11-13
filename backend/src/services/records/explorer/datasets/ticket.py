"""The `ticket` dataset: its fields, list columns, insights and what may be written."""

from __future__ import annotations

from src.core import vocabulary
from src.core.query import Field, FieldSet
from src.models.business import Ticket
from src.services.records.explorer.common import common_fields as _common
from src.services.records.explorer.model import (
    Identity,
    Insight,
    Metric,
    Resource,
    Writable,
)


def declare() -> Resource:
    return Resource(
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
    )
