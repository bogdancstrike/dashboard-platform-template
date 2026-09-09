"""Data quality — what is wrong with the records, and where to go and fix it (§65).

Every dataset in a real installation rots in the same few ways: a customer
nobody owns, a ticket marked resolved with no moment of resolution, a device
that has not reported in a month, two accounts with one email address. None of
those is a bug in the software and all of them break something downstream — a
report, a rota, a bill — so a platform that cannot show them is a platform where
somebody finds out from a customer.

Three decisions carry this module, and the first is the one that makes it worth
having at all.

**A check is declared as the list's own filter, not as its own SQL.** Each
`Check` carries the same `filters` a reader could type into the URL bar, and
both the count and the *link* come from them — so "42 unassigned open tickets"
opens exactly the forty-two rows it counted, through `apply_filters` and
`core/query`'s operator vocabulary. A count nobody can open is a count nobody
can fix, and a count computed by one query and linked to another is a count
that will eventually disagree with its own list.

**The checks the filter vocabulary cannot express say so.** `spent > budget`
compares two columns, and the query language compares a column to a *value* —
by design, because a filter bar that could name a second column is a query
builder. Those checks carry a predicate instead, are counted in SQL like the
rest, and publish a *sample* of records rather than a list link. The page draws
the difference rather than hiding it: a link that quietly returned the wrong
rows would be worse than no link.

**Severity is about the data, not about the reader.** CRITICAL is a
*contradiction* — a state that cannot be true, like an order shipped and never
paid; WARNING is a gap somebody should close; INFO is a fact worth publishing
that nobody has to act on today. Graded that way rather than by count, because
one contradiction matters more than four hundred missing phone numbers.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from datetime import timedelta
from typing import Any, Callable

from sqlalchemy import Select, func, select

from src.core import cache
from src.core.clock import iso, now
from src.core.errors import NotFoundError
from src.core.query import apply_filters, count_of
from src.services.explorer import Resource, resource_for, resources

VIEW_PERMISSION = "records.view"

#: Records named per check on the page. Enough to recognise the problem,
#: few enough that the count stays the headline — the same reasoning as the
#: bulk preview's sample.
SAMPLE = 5

#: How long since a customer was last spoken to before it is worth saying.
STALE_CONTACT_DAYS = 180

#: How long a device may be silent before somebody should look.
SILENT_DEVICE_DAYS = 14


@dataclass(frozen=True)
class Check:
    """One thing that can be wrong with a dataset.

    `filters` is the whole point: it is what a reader could type in the URL, so
    the count and the link are provably the same question. A check that needs
    SQL the filter vocabulary cannot express carries `predicate` instead and
    publishes a sample — see the module docstring.
    """

    key: str
    resource: str
    title: str
    #: What goes wrong downstream if this is left. The reason the check exists,
    #: in the words somebody would use to justify spending an hour on it.
    why: str
    #: What to do about it. A finding with no remedy is a complaint.
    fix: str
    severity: str = "WARNING"
    filters: dict[str, Any] = dataclass_field(default_factory=dict)
    #: For the checks a filter cannot express. Takes the resource and returns a
    #: SQLAlchemy clause, or a whole statement when the check is about
    #: duplication rather than about one row.
    predicate: Callable[[Resource], Any] | None = None

    @property
    def linkable(self) -> bool:
        return self.predicate is None


def _relative(days: int) -> str:
    """A moment the filter vocabulary understands, rounded to the day.

    Computed per request rather than frozen into the catalogue: "not contacted
    in six months" has to mean six months from *today*, and a constant would
    make the check slowly stop finding anything.

    Rounded to midnight, which matters twice. It is what a reader means — a
    task due at nine this morning is not "past its due date" at two in the
    afternoon, whatever the clock says — and it makes the *link* stable: a
    query string carrying `…T01:21:22.598686Z` is an address that means
    something different every time the page is opened, and two calls a
    millisecond apart produced two different links.
    """
    moment = (now() - timedelta(days=days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    return iso(moment)


def catalogue() -> list[Check]:
    """Every check, in the order a reader meets them.

    A function rather than a constant because two of the checks are relative to
    now, and a module-level tuple would freeze the day the process started.
    """
    return [
        # ── contradictions: states that cannot be true ──────────────────
        Check(
            key="ticket_resolved_without_moment",
            resource="ticket",
            title="Resolved with no moment of resolution",
            why=(
                "Every SLA figure, every resolution-time average and the whole "
                "support dashboard are computed from resolved_at. A ticket "
                "closed without one is invisible to all of them."
            ),
            fix="Reopen it and close it again, or set the date it was actually resolved.",
            severity="CRITICAL",
            filters={"status__in": "RESOLVED,CLOSED", "resolved_at__empty": "true"},
        ),
        Check(
            key="order_shipped_unpaid",
            resource="order",
            title="Shipped and never paid",
            why=(
                "The goods have gone and the money has not arrived. Revenue "
                "counts these as booked, so the ledger and the bank disagree."
            ),
            fix="Chase the payment, or mark the order refunded if it was written off.",
            severity="CRITICAL",
            filters={"fulfilment_status": "SHIPPED", "payment_status": "UNPAID"},
        ),
        Check(
            key="project_overspent",
            resource="project",
            title="Spent more than the budget",
            why=(
                "A project past its budget and still reported as on track is the "
                "single most expensive disagreement on the portfolio page."
            ),
            fix="Revise the budget, or change the reported health to match the money.",
            severity="CRITICAL",
            # Two columns compared, which the filter vocabulary deliberately
            # cannot express: a filter bar that could name a second column is a
            # query builder.
            predicate=lambda resource: resource.model.spent > resource.model.budget,
        ),
        Check(
            key="customer_duplicate_email",
            resource="customer",
            title="Two accounts, one email address",
            why=(
                "Whichever one a person opens is the one they update, and the "
                "other keeps its own history — so the account with the "
                "conversation on it is not the account with the orders."
            ),
            fix="Merge them, or correct whichever address was typed wrongly.",
            severity="CRITICAL",
            predicate=lambda resource: resource.model.email.in_(
                select(resource.model.email)
                .where(
                    resource.model.email.isnot(None),
                    resource.model.deleted_at.is_(None),
                )
                .group_by(resource.model.email)
                .having(func.count() > 1)
            ),
        ),
        # ── gaps: something somebody should close ──────────────────────
        Check(
            key="ticket_unassigned_open",
            resource="ticket",
            title="Open and unassigned",
            why="Nobody is working on it, and the clock is running against the SLA.",
            fix="Assign it, or close it if it was raised in error.",
            filters={"status__not_in": "RESOLVED,CLOSED", "assignee_id__empty": "true"},
        ),
        Check(
            key="task_overdue_open",
            resource="task",
            title="Past its due date and not finished",
            why=(
                "A plan nobody has revised is a plan nobody believes. These are "
                "the rows that make a delivery date meaningless."
            ),
            fix="Move the date, finish the work, or cancel it.",
            filters={"status__not_in": "DONE,CANCELLED", "due_date__before": _relative(0)},
        ),
        Check(
            key="task_unassigned",
            resource="task",
            title="Nobody assigned",
            why="Work with no owner is work nobody has agreed to do.",
            fix="Assign it to somebody, or put it back in the backlog.",
            filters={"assignee_id__empty": "true", "status__not_in": "DONE,CANCELLED"},
        ),
        Check(
            key="customer_no_manager",
            resource="customer",
            title="No account manager",
            why=(
                "Nobody owns the relationship, so nobody is told when it goes "
                "quiet — and the revenue on the page has no name against it."
            ),
            fix="Assign an account manager.",
            filters={"account_manager_id__empty": "true"},
        ),
        Check(
            key="project_no_owner",
            resource="project",
            title="No owner",
            why="A project with no owner has nobody to ask about it.",
            fix="Set an owner.",
            filters={"owner_id__empty": "true"},
        ),
        Check(
            key="order_no_customer",
            resource="order",
            title="Not attached to a customer",
            why=(
                "It cannot be invoiced, it is missing from the account's "
                "history, and it counts towards revenue nobody can attribute."
            ),
            fix="Attach the customer, or delete the order if it was a test.",
            filters={"customer_id__empty": "true"},
        ),
        Check(
            key="device_never_seen",
            resource="device",
            title="Never reported in",
            why=(
                "It is on the asset register and has never spoken to the "
                "platform, so nothing here knows whether it exists."
            ),
            fix="Commission it, or take it off the register.",
            filters={"last_seen_at__empty": "true"},
        ),
        # ── facts worth publishing ────────────────────────────────────
        Check(
            key="device_silent",
            resource="device",
            title=f"Silent for more than {SILENT_DEVICE_DAYS} days",
            why=(
                "A device that has stopped reporting looks healthy on every "
                "chart, because the last thing it said was that it was fine."
            ),
            fix="Check it is powered and on the network.",
            severity="INFO",
            filters={"last_seen_at__before": _relative(SILENT_DEVICE_DAYS)},
        ),
        Check(
            key="customer_stale_contact",
            resource="customer",
            title=f"Not contacted in {STALE_CONTACT_DAYS} days",
            why=(
                "An account nobody has spoken to in six months is an account "
                "that renews by accident or not at all."
            ),
            fix="Get in touch, and record it.",
            severity="INFO",
            filters={"last_contact_at__before": _relative(STALE_CONTACT_DAYS)},
        ),
        Check(
            key="customer_no_email",
            resource="customer",
            title="No email address",
            why="Nothing the platform sends can reach them.",
            fix="Add an address.",
            severity="INFO",
            filters={"email__empty": "true"},
        ),
    ]


def overview(session, *, principal, resource_key: str = "") -> dict[str, Any]:
    """Every check, counted, with somewhere to go for each (§65)."""
    principal.require(VIEW_PERMISSION)
    checks = catalogue()
    if resource_key:
        # Validated, so an unknown dataset is a *refusal* rather than an empty
        # page that looks exactly like a clean bill of health. `resource_for`
        # raises a 400 naming the datasets that do exist, which is more use
        # than a 404: the caller has usually mistyped one of them.
        resource_for(resource_key, principal=principal)
        checks = [check for check in checks if check.resource == resource_key]

    findings = [_finding(session, check, principal=principal) for check in checks]
    counted = [finding for finding in findings if finding["count"] > 0]

    return {
        "resource_type": resource_key,
        "generated_at": iso(now()),
        "findings": findings,
        "totals": {
            # Findings rather than rows: "four things are wrong" is what somebody
            # acts on, and one contradiction matters more than four hundred
            # missing phone numbers.
            "checks": len(findings),
            "failing": len(counted),
            "records": sum(finding["count"] for finding in counted),
            "by_severity": {
                severity: sum(
                    1 for finding in counted if finding["severity"] == severity
                )
                for severity in ("CRITICAL", "WARNING", "INFO")
            },
        },
        "datasets": _datasets(session, principal=principal),
    }


def summary(session, resource_key: str, *, principal) -> dict[str, Any]:
    """How many findings one dataset has, for the indicator on its list (§65).

    Deliberately just the counts. A list page wants a chip saying "3 data
    issues" that opens the page which explains them; putting the explanations
    on every list would be the quality page rendered six times.
    """
    principal.require(VIEW_PERMISSION)
    resource = resource_for(resource_key, principal=principal)
    return cache.aggregate(
        f"quality:summary:{resource.key}",
        {},
        depends_on=(resource.key,),
        producer=lambda: _summary(session, resource, principal=principal),
    )


def _summary(session, resource: Resource, *, principal) -> dict[str, Any]:
    counts = {"CRITICAL": 0, "WARNING": 0, "INFO": 0}
    records = 0
    failing = 0
    for check in catalogue():
        if check.resource != resource.key:
            continue
        count = _count(session, check, resource)
        if count == 0:
            continue
        failing += 1
        records += count
        counts[check.severity] = counts.get(check.severity, 0) + 1

    return {
        "resource_type": resource.key,
        "failing": failing,
        "records": records,
        "by_severity": counts,
        # The worst thing found, so a chip can be one colour rather than three.
        "worst": (
            "CRITICAL" if counts["CRITICAL"] else "WARNING" if counts["WARNING"] else
            "INFO" if counts["INFO"] else ""
        ),
    }


# ── counting ─────────────────────────────────────────────────────────────


def _statement(check: Check, resource: Resource) -> Select:
    """The rows a check finds, through the list's own filters where it can be.

    `_base_statement` is the explorer's, so the soft-delete rule is the one
    every list already applies — a quality report that counted deleted records
    would report problems nobody can open.
    """
    from src.services.explorer import _base_statement

    statement = _base_statement(resource)
    if check.predicate is not None:
        return statement.where(check.predicate(resource))
    return apply_filters(statement, dict(check.filters), resource.fields)


def _count(session, check: Check, resource: Resource) -> int:
    return int(count_of(session, _statement(check, resource)))


def _finding(session, check: Check, *, principal) -> dict[str, Any]:
    resource = resource_for(check.resource, principal=principal)
    statement = _statement(check, resource)
    count = int(count_of(session, statement))

    rows = (
        session.scalars(statement.limit(SAMPLE)).unique().all() if count else []
    )
    return {
        "key": check.key,
        "resource_type": resource.key,
        "resource_label": resource.label,
        "title": check.title,
        "why": check.why,
        "fix": check.fix,
        "severity": check.severity,
        "count": count,
        # The address the reader goes to. Present only when the check *is* a
        # filter, because a link that returned different rows from the count
        # beside it would be worse than no link at all.
        "link": _link(resource, check) if check.linkable else "",
        "why_no_link": (
            ""
            if check.linkable
            else "This compares two columns, which a filter cannot express — so the records are named here instead."
        ),
        "sample": [
            {
                "id": str(row.id),
                "label": resource.label_for(row),
                "path": f"{resource.path}/{row.id}",
            }
            for row in rows
        ],
    }


def _link(resource: Resource, check: Check) -> str:
    """The list, narrowed to exactly the rows the count found.

    `f.` prefixed, which is how the entity pages carry a filter in the URL — so
    this is the address a reader would have typed, and the page that opens is
    the page they already know.
    """
    parts = [f"f.{name}={value}" for name, value in sorted(check.filters.items())]
    return f"{resource.path}?{'&'.join(parts)}" if parts else resource.path


def _datasets(session, *, principal) -> list[dict[str, Any]]:
    """Each dataset with its own failing count, for the page's own navigation."""
    keys = sorted({check.resource for check in catalogue()})
    out = []
    for key in keys:
        try:
            resource = resource_for(key, principal=principal)
        except NotFoundError:  # pragma: no cover - a dataset removed from the catalogue
            continue
        found = _summary(session, resource, principal=principal)
        out.append({**found, "label": resource.label, "path": resource.path})
    return out
