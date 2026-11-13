"""Seeded report documents (§28): the weekly and monthly reports people print.

Without these the Report builder opened on an empty gallery after a reseed.
Each document is built from the blocks the builder itself offers — headings,
paragraphs, a headline-numbers strip, charts that ask their own question,
saved reports by reference, and a table — and goes through the service's own
validation, so a seeded document is exactly one a person could have saved.

Dimensions are read from the analysis catalogue at seed time rather than
written here, so a dataset that renames a field does not leave a document that
renders "unknown dimension". `--sync-report-documents` adds what is missing.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import select

from src.core.clock import now

#: (owner, name, description, scope, cadence, entity of focus, accent, days since last render)
DOCUMENTS: tuple[tuple[str, str, str, str, str, str, str, int | None], ...] = (
    ("admin", "Weekly operations review", "Monday's one-pager: what moved last week in tickets and tasks, and what is late.",
     "PUBLIC", "weekly", "ticket", "#2457d6", 3),
    ("admin", "Monthly revenue report", "Orders, revenue and the customers behind them, for the month-end close.",
     "PUBLIC", "monthly", "order", "#0f7b5f", 12),
    ("manager", "Support quality — monthly", "Ticket volume by priority and status, and the oldest open ones, for the support lead.",
     "PUBLIC", "monthly", "ticket", "#b54708", 20),
    ("manager", "Delivery status — weekly", "Project and task progress for the Friday stakeholder update.",
     "PRIVATE", "weekly", "task", "#6941c6", None),
    ("admin", "Customer portfolio — quarterly", "Who the customers are, by segment and region, with the largest accounts listed.",
     "PRIVATE", "monthly", "customer", "#2457d6", 45),
)


def _principal(user):
    from src.core.auth import ROLE_DEFAULTS, Principal

    code = "MANAGER" if user.username == "manager" else "ADMINISTRATOR"
    return Principal(user_id=user.id, subject="", email=user.email or "", username=user.username,
                     full_name=user.full_name, role_code=code,
                     permissions=frozenset(ROLE_DEFAULTS[code]["permissions"]),
                     organization_id=user.organization_id)


def _dimension(datasets: dict[str, Any], entity: str, *prefer: str) -> str | None:
    """The first dimension of `entity` whose name contains one of `prefer`, else its first."""
    dims = [d["name"] for d in (datasets.get(entity) or {}).get("dimensions", [])]
    for wanted in prefer:
        for name in dims:
            if wanted in name:
                return name
    return dims[0] if dims else None


def _blocks(entity: str, cadence: str, datasets: dict[str, Any], report_ids: list[str]) -> list[dict[str, Any]]:
    period = "last_7_days" if cadence == "weekly" else "last_30_days"
    span = "week" if cadence == "weekly" else "month"
    label = (datasets.get(entity) or {}).get("label", entity).lower()
    status = _dimension(datasets, entity, "status", "stage")
    second = _dimension(datasets, entity, "priority", "segment", "region", "industry", "type", "category")
    blocks: list[dict[str, Any]] = [
        {"kind": "HEADING", "text": "Summary", "level": 1},
        {"kind": "TEXT", "text": (
            f"This {span}'s {label} at a glance. The numbers below are live: they are recomputed every "
            f"time the document is rendered, so a copy printed today and one printed next {span} differ "
            "by exactly what changed."
        )},
        {"kind": "METRICS", "entity": entity, "caption": f"Headline numbers — {label}"},
        {"kind": "DIVIDER"},
        {"kind": "HEADING", "text": "Where things stand", "level": 2},
    ]
    if status:
        blocks.append({"kind": "CHART", "entity": entity, "chart": "bar", "dimension": status,
                       "aggregation": "count", "period": period, "show": "both",
                       "caption": f"{label.capitalize()} by {status.replace('_', ' ')}"})
    blocks.append({"kind": "CHART", "entity": entity, "chart": "line", "dimension": "created_at",
                   "granularity": "day" if cadence == "weekly" else "week", "aggregation": "count",
                   "period": period, "show": "chart", "caption": f"New {label} over the {span}"})
    if second and second != status:
        blocks.append({"kind": "CHART", "entity": entity, "chart": "pie", "dimension": second,
                       "aggregation": "count", "period": period, "show": "chart",
                       "caption": f"Share by {second.replace('_', ' ')}"})
    for report_id in report_ids[:2]:
        blocks.append({"kind": "REPORT", "report_id": report_id, "show": "both", "caption": ""})
    blocks += [
        {"kind": "PAGE_BREAK"},
        {"kind": "HEADING", "text": "The detail", "level": 2},
        {"kind": "TEXT", "text": "The most recent rows, newest first. The full list is one click away in the Data Explorer."},
        {"kind": "TABLE", "entity": entity, "sort": "created_at", "order": "desc", "limit": 15,
         "caption": f"Latest {label}"},
        {"kind": "SPACER", "size": "medium"},
        {"kind": "TEXT", "text": "Questions about these numbers go to the owner of this document."},
    ]
    return blocks


def seed(session) -> dict[str, int]:
    from src.models.identity import User
    from src.models.personal import Report, ReportDocument
    from src.seed.support import slugify
    from src.services.analytics import analysis
    from src.services.analytics import report_documents as service

    users = {u.username: u for u in session.scalars(select(User).where(User.username.in_(("admin", "manager"))))}
    made = 0
    for index, (username, name, description, scope, cadence, entity, accent, rendered) in enumerate(DOCUMENTS):
        user = users.get(username)
        if user is None:
            continue
        exists = session.scalars(select(ReportDocument.id).where(
            ReportDocument.owner_id == user.id, ReportDocument.name == name)).first()
        if exists is not None:
            continue
        principal = _principal(user)
        datasets = {d["key"]: d for d in analysis.catalogue(principal=principal)["datasets"]}
        if entity not in datasets:
            continue
        reports = [str(r) for r in session.scalars(
            select(Report.id).where(Report.resource_type == entity, Report.deleted_at.is_(None),
                                   # Only reports everybody reading the document can open.
                                   Report.scope == "PUBLIC")
            .order_by(Report.run_count.desc()).limit(2))]
        payload = {
            "name": name,
            "description": description,
            "scope": scope,
            "page": {**service.DEFAULT_PAGE, "accent": accent,
                     "subtitle": f"{cadence.capitalize()} report · {datasets[entity]['label']}",
                     "header": name, "footer": "Internal — Northwind"},
            "blocks": [{**block, "id": f"b{i + 1}"} for i, block in
                       enumerate(_blocks(entity, cadence, datasets, reports))],
        }
        fields = service._validated(payload, principal=principal, partial=False)
        created = now() - timedelta(days=60 - index * 7)
        session.add(ReportDocument(
            name=fields.get("name", name), slug=slugify(name)[:120], description=description,
            owner_id=user.id, organization_id=user.organization_id, scope=fields.get("scope", scope),
            page=fields.get("page"), blocks=fields.get("blocks"),
            last_rendered_at=(now() - timedelta(days=rendered, hours=2)) if rendered is not None else None,
            render_count=0 if rendered is None else 4 + index * 3,
            created_at=created, updated_at=created + timedelta(days=2),
        ))
        made += 1
    session.flush()
    return {"documents": made}


def seed_safely(session) -> dict[str, Any]:
    """`seed` inside a savepoint, so a problem here never costs the rest of the dataset."""
    from framework.commons.logger import logger as log

    try:
        with session.begin_nested():
            return seed(session)
    except Exception as exc:  # noqa: BLE001 - the rest of the dataset must still land
        log.warning(f"seed[report-documents] skipped: {type(exc).__name__}: {exc} — "
                    "run 'python -m src.seed --sync-report-documents'", "yellow")
        return {"documents": 0, "skipped": type(exc).__name__}
