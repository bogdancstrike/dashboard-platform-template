"""Every data-quality check, declared."""

from __future__ import annotations

from sqlalchemy import func, select

from src.services.records.quality.checks import (
    SILENT_DEVICE_DAYS,
    STALE_CONTACT_DAYS,
    Check,
    _relative,
)


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
