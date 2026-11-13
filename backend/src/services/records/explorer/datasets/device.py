"""The `device` dataset: its fields, list columns, insights and what may be written."""

from __future__ import annotations

from src.core import vocabulary
from src.core.query import Field, FieldSet
from src.models.business import Device
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
    )
