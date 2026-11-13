"""Sample records: what can be loaded, loading and removing them."""

from __future__ import annotations

import random
import uuid
from datetime import timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from src.core.clock import now
from src.core.errors import NotFoundError, ValidationError
from src.core.repository import found_or_404
from src.models.onboarding import SampleRecord
from src.services.platform.onboarding.steps import SAMPLE_PERMISSION

CUSTOMERS = ("Halvorsen Logistics", "Bright Harbor Foods", "Kestrel Analytics", "Mosaic Health Partners",
             "Northgate Utilities", "Pinewood Studios", "Quayside Retail Group", "Solent Marine Services")


PROJECTS = ("Warehouse scanner rollout", "Customer portal refresh", "Billing system migration",
            "Field service mobile app", "Data platform consolidation")


TASKS = ("Draft the rollout plan", "Review vendor contract", "Set up staging environment", "Write acceptance tests",
         "Migrate historical invoices", "Train the support team", "Configure single sign-on", "Fix export timeout",
         "Design the onboarding emails", "Audit user permissions", "Prepare the steering update", "Load-test the API")


TICKETS = ("Cannot reset password", "Invoice total is off by one cent", "Export to CSV times out", "Need access to reports",
           "Dashboard loads slowly", "Duplicate notification emails", "Wrong timezone on due dates", "Feature request: dark mode")


DEVICES = ("Dock door sensor", "Cold room thermometer", "Gateway — north wing", "Camera — loading bay",
           "Energy meter — line 2", "Beacon — reception")


AREAS: dict[str, dict[str, Any]] = {
    "customers": {"label": "Customers", "resource": "customer", "route": "/customers"},
    "projects": {"label": "Projects", "resource": "project", "route": "/projects"},
    "tasks": {"label": "Tasks", "resource": "task", "route": "/tasks"},
    "tickets": {"label": "Tickets", "resource": "ticket", "route": "/tickets"},
    "orders": {"label": "Orders", "resource": "order", "route": "/orders"},
    "devices": {"label": "Devices", "resource": "device", "route": "/devices"},
}


def _payloads(area: str, rng: random.Random) -> list[dict[str, Any]]:
    today = now()
    note = "Sample data — remove it from Getting started → Sample data."
    if area == "customers":
        return [{"name": name, "email": f"hello@{name.split()[0].lower()}.example", "status": "ACTIVE",
                 "segment": rng.choice(("SMB", "MID_MARKET", "ENTERPRISE")), "industry": rng.choice(("Logistics", "Retail", "Health", "Energy", "Media")),
                 "lifecycle_stage": rng.choice(("PROSPECT", "CUSTOMER", "RENEWAL")), "country": rng.choice(("GB", "DE", "NL", "RO")),
                 "lifetime_value": rng.randint(8, 400) * 1000, "satisfaction": round(rng.uniform(6, 9.8), 1)} for name in CUSTOMERS]
    if area == "projects":
        return [{"name": name, "description": note, "status": rng.choice(("ACTIVE", "PLANNING")), "phase": rng.choice(("DISCOVERY", "EXECUTION")),
                 "priority": rng.choice(("NORMAL", "HIGH")), "health": rng.choice(("ON_TRACK", "AT_RISK")),
                 "start_date": (today - timedelta(days=rng.randint(5, 40))).isoformat(),
                 "due_date": (today + timedelta(days=rng.randint(20, 120))).isoformat(),
                 "budget": rng.randint(20, 300) * 1000, "currency": "EUR", "progress": rng.randint(5, 70)} for name in PROJECTS]
    if area == "tasks":
        return [{"title": title, "description": note, "status": rng.choice(("NEW", "IN_PROGRESS", "IN_REVIEW", "DONE")),
                 "priority": rng.choice(("LOW", "NORMAL", "HIGH", "CRITICAL")), "kind": rng.choice(("TASK", "BUG", "FEATURE")),
                 "due_date": (today + timedelta(days=rng.randint(-3, 21))).isoformat(), "estimate_hours": rng.randint(1, 16)}
                for title in TASKS]
    if area == "tickets":
        return [{"subject": subject, "description": note, "status": rng.choice(("OPEN", "IN_PROGRESS", "WAITING_CUSTOMER")),
                 "priority": rng.choice(("LOW", "NORMAL", "HIGH", "CRITICAL")), "category": rng.choice(("SUPPORT", "BUG", "BILLING", "ACCESS")),
                 "channel": rng.choice(("EMAIL", "PORTAL", "CHAT"))} for subject in TICKETS]
    if area == "orders":
        return [{"status": rng.choice(("CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED")), "payment_status": rng.choice(("PAID", "UNPAID")),
                 "channel": rng.choice(("DIRECT", "PORTAL", "PARTNER")), "placed_at": (today - timedelta(days=rng.randint(0, 30))).isoformat(),
                 "total": rng.randint(120, 9000), "currency": "EUR", "item_count": rng.randint(1, 12), "notes": note} for _ in range(8)]
    return [{"name": name, "kind": rng.choice(("SENSOR", "GATEWAY", "CAMERA", "METER", "BEACON")), "manufacturer": "Acme IoT",
             "status": rng.choice(("ONLINE", "ONLINE", "DEGRADED", "OFFLINE")), "location": "Sample site",
             "battery_percent": rng.randint(20, 100), "signal_strength": rng.randint(-95, -40)} for name in DEVICES]


def samples(session, *, principal) -> dict[str, Any]:
    principal.require(SAMPLE_PERMISSION)
    counts = dict(session.execute(select(SampleRecord.area, func.count()).group_by(SampleRecord.area)).all())
    return {"areas": [{"key": key, "label": spec["label"], "route": spec["route"], "loaded": int(counts.get(key, 0))}
                      for key, spec in AREAS.items()]}


def load(session, area: str, *, principal) -> dict[str, Any]:
    """Create a tagged sample dataset for one area. Refused if it is already loaded."""
    from src.services.records import writes as record_writes
    from src.services.records.explorer import resources

    principal.require(SAMPLE_PERMISSION)
    spec = found_or_404(
        AREAS.get(area), "There is no sample data for that area.", details={"areas": sorted(AREAS)}
    )
    if session.scalar(select(SampleRecord.id).where(SampleRecord.area == area).limit(1)):
        raise ValidationError(f"Sample {spec['label'].lower()} are already loaded — remove them first to load again.")
    rows = record_writes.create_many(session, spec["resource"], _payloads(area, random.Random(area)), principal=principal)
    resource = resources()[spec["resource"]]
    batch = uuid.uuid4().hex
    for row in rows:
        session.add(SampleRecord(area=area, batch_id=batch, resource_type=spec["resource"], record_id=str(row.id),
                                 label=resource.label_for(row)[:240], created_by_id=principal.user_id))
    session.flush()
    return {"area": area, "created": len(rows), **samples(session, principal=principal)}


def remove(session, area: str, *, principal) -> dict[str, Any]:
    """Delete exactly the records a load created — nothing else."""
    from src.services.records.explorer import resources

    principal.require(SAMPLE_PERMISSION)
    if area not in AREAS:
        raise NotFoundError("There is no sample data for that area.")
    tags = session.scalars(select(SampleRecord).where(SampleRecord.area == area)).all()
    sample_ids = set(session.scalars(select(SampleRecord.record_id)).all())
    removed = kept = 0
    for tag in tags:
        resource = resources().get(tag.resource_type)
        row = session.get(resource.model, uuid.UUID(tag.record_id)) if resource else None
        if row is not None:
            if _referenced(session, resource.model.__table__, row.id, sample_ids):
                # Something real now points at it (a real task in a sample
                # project, say). Deleting would null or break that reference,
                # which is touching real data — so it is hidden instead.
                row.deleted_at = now()
                kept += 1
            else:
                try:
                    with session.begin_nested():
                        session.delete(row)
                        session.flush()
                    removed += 1
                except IntegrityError:  # pragma: no cover - guarded by _referenced
                    row.deleted_at = now()
                    kept += 1
        session.delete(tag)
    session.flush()
    return {"area": area, "removed": removed, "hidden": kept, **samples(session, principal=principal)}


def _referenced(session, table, record_id, sample_ids: set[str]) -> bool:
    """Whether any row that is not itself sample data points at this record."""
    from sqlalchemy import column as sql_column
    from sqlalchemy import table as sql_table

    from src.models.base import Base

    for other in Base.metadata.sorted_tables:
        for key in other.foreign_keys:
            if key.column.table is not table:
                continue
            if "id" not in other.c:
                # An association row (no id of its own) is always real.
                link = sql_table(other.name, sql_column(key.parent.name))
                if session.execute(select(link.c[key.parent.name]).where(
                        link.c[key.parent.name] == record_id).limit(1)).first():
                    return True
                continue
            referrer = sql_table(other.name, sql_column(key.parent.name), sql_column("id"))
            ids = [str(value) for value in session.execute(
                select(referrer.c.id).where(referrer.c[key.parent.name] == record_id).limit(50)
            ).scalars()]
            if any(item not in sample_ids for item in ids):
                return True
    return False
