"""The `customer` dataset: its fields, list columns, insights and what may be written."""

from __future__ import annotations

from src.core import vocabulary
from src.core.query import Field, FieldSet
from src.models.business import Customer
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
            # Customer health (§12): the current score and band, carried on
            # the row by `models/records_analytics` — so the list filters,
            # sorts and facets by health like any other column.
            Field("health_score", Customer.health_score, kind="number", label="Health score"),
            Field("health_band", Customer.health_band, kind="enum", facet=True,
                  choices=("HEALTHY", "AT_RISK", "CRITICAL"), label="Health"),
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
    )
