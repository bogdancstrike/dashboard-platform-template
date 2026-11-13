"""Seed data for collab: _wiki_pages, SPACES, _links_for."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from src.seed.collab.chat import _first, _t


def _wiki_pages(session) -> dict[str, list[tuple[str, str, str | None, list[dict[str, Any]]]]]:
    """space key → [(title, icon, parent title, blocks)]."""
    from src.models.business import Customer, Project, Ticket

    project = _first(session, Project, Project.deleted_at.is_(None), order=Project.created_at)
    ticket = _first(session, Ticket, Ticket.deleted_at.is_(None), order=Ticket.created_at.desc())
    customer = _first(session, Customer, Customer.deleted_at.is_(None), order=Customer.created_at)

    def record(kind: str, row) -> list[dict[str, Any]]:
        if row is None:
            return []
        label = getattr(row, "name", None) or getattr(row, "title", None) or getattr(row, "reference", "")
        return [_t("record", resource_type=kind, resource_id=str(row.id), label=str(label))]

    return {
        "engineering": [
            ("Engineering handbook", "🛠️", None, [
                _t("callout", tone="info", text="Start here. How we build, ship and support the platform."),
                _t("heading", level=2, text="How we work"),
                _t("list", ordered=False, items=[
                    "Every change goes through review by one other engineer",
                    "Main is always deployable; feature flags hide unfinished work",
                    "Incidents get a written review within five working days",
                ]),
                _t("heading", level=2, text="Where things live"),
                _t("table", header=True, rows=[
                    ["What", "Where", "Owner"],
                    ["Source code", "Git, main branch", "Engineering"],
                    ["Runbooks", "This space", "On-call rota"],
                    ["Release notes", "#engineering", "Release manager"],
                ]),
            ]),
            ("On-call runbook", "🚨", "Engineering handbook", [
                _t("callout", tone="warning", text="Use this when the pager goes off. **Acknowledge first**, "
                   "then diagnose."),
                _t("heading", level=2, text="First five minutes"),
                _t("checklist", items=[
                    {"text": "Acknowledge the alert", "done": True},
                    {"text": "Open System health and check the failing service", "done": True},
                    {"text": "Post a short status in #engineering", "done": False},
                ]),
                _t("heading", level=2, text="Restarting the API"),
                _t("code", language="bash", text="docker compose restart api\ndocker compose logs -f api --tail 100"),
                _t("heading", level=2, text="Escalation"),
                _t("text", text="If the service is still unhealthy after 20 minutes, call the engineering "
                   "manager. Customer-facing outages also page the support lead."),
                _t("quote", text="Write down what you did as you do it — the review will thank you."),
            ]),
            ("Release checklist", "✅", "Engineering handbook", [
                _t("checklist", items=[
                    {"text": "Changelog drafted", "done": True},
                    {"text": "Migrations reviewed", "done": True},
                    {"text": "Staging smoke tests green", "done": False},
                    {"text": "Release announced in #general", "done": False},
                ]),
            ]),
            ("Architecture overview", "🏛️", None, [
                _t("text", text="The platform is a React front end over a Python API, with PostgreSQL for "
                   "records, Redis for caching and live delivery, and object storage for files."),
                _t("heading", level=2, text="Support load at a glance"),
                _t("chart", entity="ticket", dimension="status", chart="bar", aggregation="count", show="chart",
                   caption="Tickets by status"),
                _t("heading", level=2, text="Related"),
                *record("project", project),
            ]),
        ],
        "operations": [
            ("Support playbook", "📦", None, [
                _t("callout", tone="success", text="Our promise: every customer hears from a person within "
                   "one business hour."),
                _t("heading", level=2, text="Triage"),
                _t("list", ordered=True, items=[
                    "Read the whole ticket, including attachments",
                    "Set priority from the impact table below",
                    "Assign to the right queue, or take it",
                ]),
                _t("table", header=True, rows=[
                    ["Impact", "Priority", "First response"],
                    ["Many customers blocked", "Critical", "15 minutes"],
                    ["One customer blocked", "High", "1 hour"],
                    ["Workaround exists", "Normal", "1 business day"],
                ]),
                _t("heading", level=2, text="A recent example"),
                *record("ticket", ticket),
            ]),
            ("Escalation matrix", "📞", "Support playbook", [
                _t("table", header=True, rows=[
                    ["Area", "First contact", "Second contact"],
                    ["Billing", "Finance desk", "Head of finance"],
                    ["Outage", "On-call engineer", "Engineering manager"],
                    ["Security", "Security officer", "CTO"],
                ]),
            ]),
            ("Key accounts", "⭐", None, [
                _t("text", text="Accounts with a named success manager and a quarterly business review."),
                *record("customer", customer),
            ]),
        ],
        "product": [
            ("Q4 roadmap", "🗺️", None, [
                _t("heading", level=2, text="Themes"),
                _t("list", ordered=False, items=["Collaboration: chat, wiki and meeting notes",
                                                  "Faster search across every dataset",
                                                  "Self-service onboarding"]),
                _t("heading", level=2, text="Open questions"),
                _t("checklist", items=[{"text": "Do we need guest access to the wiki?", "done": False},
                                       {"text": "Pricing for the AI assistant", "done": False}]),
                *record("project", project),
            ]),
            ("Sprint retro — week 45", "🔁", "Q4 roadmap", [
                _t("heading", level=2, text="What went well"),
                _t("list", ordered=False, items=["Release went out on time", "Fewer flaky tests"]),
                _t("heading", level=2, text="What did not"),
                _t("list", ordered=False, items=["Too many meetings on Wednesday"]),
                _t("heading", level=2, text="What we will try"),
                _t("action", text="Make Wednesday afternoons meeting-free", assignee_id=None,
                   due_date=None, task_id=None, done=False),
            ]),
        ],
    }


SPACES: tuple[tuple[str, str, str, str, str], ...] = (
    ("engineering", "Engineering", "🛠️", "#2457D6", "How we build, ship and run the platform."),
    ("operations", "Operations", "📦", "#B45309", "Support, escalation and the accounts we look after."),
    ("product", "Product", "📐", "#7C3AED", "Roadmaps, specs and retrospectives."),
)


def _links_for(session, page) -> None:
    from src.models.collab import DocLink
    from src.services.records.explorer import resource_for

    for block in page.blocks or []:
        if block.get("kind") != "record":
            continue
        resource = resource_for(block["resource_type"])
        record = session.get(resource.model, UUID(block["resource_id"]))
        if record is None:
            continue
        session.add(DocLink(page_id=page.id, resource_type=block["resource_type"],
                            resource_id=block["resource_id"], label=resource.label_for(record),
                            source="MENTION", created_by_id=page.created_by_id))
