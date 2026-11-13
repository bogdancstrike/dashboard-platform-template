"""The `order` dataset: its fields, list columns, insights and what may be written."""

from __future__ import annotations

from src.core import vocabulary
from src.core.query import Field, FieldSet
from src.models.business import Order
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
    )
