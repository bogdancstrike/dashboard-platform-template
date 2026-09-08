"""The closed value sets of the domain, declared once.

Every enum column in the platform has a vocabulary, and that vocabulary is read
by three different things: the seed that writes the rows, the query builder that
offers the values to filter by, and the UI that colours them. When each keeps
its own copy they drift, and the drift is silent in the worst possible way — a
filter menu that simply never offers `IN_REVIEW` looks like a dataset with no
tasks in review, not like a bug.

So the names live here, the seed attaches weights to them (`seed/catalog.py`)
and the explorer attaches them to columns (`services/explorer.py`). Neither
spells a value out.

Order is significant: it is the order the seed's weights line up with, and the
order the values appear in a filter menu. Both read better as a lifecycle —
`NEW … DONE`, `PENDING … DELIVERED` — than alphabetically.
"""

from __future__ import annotations

Vocabulary = tuple[str, ...]

# ── shared across entities ───────────────────────────────────────────────

PRIORITY: Vocabulary = ("LOW", "NORMAL", "HIGH", "CRITICAL")
SEVERITY: Vocabulary = ("MINOR", "MODERATE", "MAJOR", "CRITICAL")

# ── work ─────────────────────────────────────────────────────────────────

TASK_STATUS: Vocabulary = (
    "NEW", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED",
)
TASK_KIND: Vocabulary = ("TASK", "BUG", "FEATURE", "CHORE", "INCIDENT", "REQUEST")

# ── support ──────────────────────────────────────────────────────────────

TICKET_STATUS: Vocabulary = (
    "OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED",
)
TICKET_CATEGORY: Vocabulary = (
    "SUPPORT", "BUG", "BILLING", "ACCESS", "PERFORMANCE", "DATA", "FEATURE_REQUEST",
)
TICKET_CHANNEL: Vocabulary = ("EMAIL", "PORTAL", "PHONE", "CHAT", "API")

# ── delivery ─────────────────────────────────────────────────────────────

PROJECT_STATUS: Vocabulary = (
    "ACTIVE", "PLANNING", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED",
)
PROJECT_PHASE: Vocabulary = ("DISCOVERY", "DESIGN", "EXECUTION", "ROLLOUT", "CLOSURE")
PROJECT_HEALTH: Vocabulary = ("ON_TRACK", "AT_RISK", "OFF_TRACK")

# ── accounts ─────────────────────────────────────────────────────────────

CUSTOMER_STATUS: Vocabulary = ("ACTIVE", "INACTIVE", "BLOCKED")
CUSTOMER_SEGMENT: Vocabulary = ("SMB", "MID_MARKET", "ENTERPRISE", "STRATEGIC")
LIFECYCLE_STAGE: Vocabulary = ("LEAD", "PROSPECT", "CUSTOMER", "RENEWAL", "CHURNED")

# ── commerce ─────────────────────────────────────────────────────────────

ORDER_STATUS: Vocabulary = (
    "PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED",
)
PAYMENT_STATUS: Vocabulary = ("PAID", "UNPAID", "PARTIAL", "REFUNDED", "OVERDUE")
FULFILMENT_STATUS: Vocabulary = ("PENDING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED")
ORDER_CHANNEL: Vocabulary = ("DIRECT", "PORTAL", "PARTNER", "MARKETPLACE", "PHONE")
CURRENCY: Vocabulary = ("EUR", "USD", "GBP")

# ── estate ───────────────────────────────────────────────────────────────

DEVICE_KIND: Vocabulary = ("SENSOR", "GATEWAY", "CONTROLLER", "CAMERA", "METER", "BEACON")
DEVICE_STATUS: Vocabulary = (
    "ONLINE", "OFFLINE", "DEGRADED", "MAINTENANCE", "DECOMMISSIONED",
)

# ── notifications ────────────────────────────────────────────────────────

#: What a notification is *about*. `ALERT` is here because an automation
#: writes one when it fires (§49) — and it was missing from the filter
#: vocabulary for a while, which made every notification an automation had
#: sent unfilterable: present in the list, absent from the only control that
#: narrows it.
NOTIFICATION_CATEGORY: Vocabulary = (
    "MENTION", "ASSIGNMENT", "APPROVAL", "ALERT", "SYSTEM", "SECURITY", "REPORT",
)
#: Deliberately not `SEVERITY`. That vocabulary grades an *incident*
#: (MINOR…CRITICAL); this grades how loudly to say something, and the two have
#: only the last value in common.
NOTIFICATION_SEVERITY: Vocabulary = ("INFO", "WARNING", "CRITICAL")

# ── mail ─────────────────────────────────────────────────────────────────

#: Where a thread lives. `OUTBOX` is the honest folder for a message the
#: platform has written and nothing has transported: there is no mail transport
#: here, and calling it `SENT` would have the mailbox claim delivery it cannot
#: make. `TRASH` is a folder rather than a flag so "empty the bin" is one
#: query and a deleted thread is still recoverable until it is not.
EMAIL_FOLDER: Vocabulary = (
    "INBOX", "OUTBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH",
)
#: The folders the seed fills. `OUTBOX` and `TRASH` are reached by using the
#: product, and seeding them would be inventing history.
EMAIL_SEEDED_FOLDER: Vocabulary = ("INBOX", "SENT", "ARCHIVE", "DRAFTS", "SPAM")
EMAIL_PRIORITY: Vocabulary = ("LOW", "NORMAL", "HIGH")

# ── calendar ─────────────────────────────────────────────────────────────

EVENT_CATEGORY: Vocabulary = (
    "MEETING", "REVIEW", "DEADLINE", "TRAINING", "MAINTENANCE", "HOLIDAY",
)
EVENT_STATUS: Vocabulary = ("CONFIRMED", "TENTATIVE", "CANCELLED")
#: What a person has said about an invitation. `NEEDS_ACTION` is the state an
#: invitation starts in and is deliberately not "declined": an unanswered
#: invitation and a refused one are different facts about the same person.
EVENT_RESPONSE: Vocabulary = ("NEEDS_ACTION", "ACCEPTED", "TENTATIVE", "DECLINED")
#: The recurrence frequencies the expander understands. Stored on the event as
#: an RRULE-shaped document; anything outside this list is refused on write
#: rather than silently producing a series nobody sees.
EVENT_FREQUENCY: Vocabulary = ("DAILY", "WEEKLY", "MONTHLY")

# ── identity ─────────────────────────────────────────────────────────────

USER_STATUS: Vocabulary = ("ACTIVE", "INVITED", "SUSPENDED", "DISABLED")

#: What a group is *for*, which is not what it grants.
#:
#: A closed set because the kind is a filter and a heading on
#: `/admin/groups`, and a kind typed into a seed row (which is where these
#: lived) is one the page's filter has never heard of.
GROUP_KIND: Vocabulary = ("TEAM", "OPERATIONAL", "GOVERNANCE", "BUSINESS")

# ── operations ───────────────────────────────────────────────────────────

#: Ordered by severity, quietest first, and *relied upon* to be: the log
#: viewer's "this level and worse" filter is a slice of this tuple, so the
#: order is the meaning and not a presentation choice.
LOG_LEVEL: Vocabulary = ("DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL")

#: What a background job is for. The queue a job runs on is *not* a closed set
#: — a deployment adds queues — so it is faceted from the data instead.
JOB_KIND: Vocabulary = (
    "EXPORT", "IMPORT", "REPORT", "EMAIL", "MAINTENANCE", "SYNC", "REINDEX",
)

#: A job's lifecycle. RETRYING is deliberately its own state rather than a
#: flag on FAILED: "failed and will be tried again" and "failed and will not"
#: are the two answers an operator needs to tell apart at a glance.
JOB_STATUS: Vocabulary = (
    "QUEUED", "RUNNING", "RETRYING", "SUCCEEDED", "FAILED", "CANCELLED",
)

#: The states from which nothing more happens on its own. Retry is offered on
#: these and refused on the others, because retrying a running job is how one
#: job becomes two writing the same rows.
JOB_TERMINAL: Vocabulary = ("SUCCEEDED", "FAILED", "CANCELLED")

#: And the states a cancel can still reach.
JOB_CANCELLABLE: Vocabulary = ("QUEUED", "RUNNING", "RETRYING")


def weighted(values: Vocabulary, weights: tuple[float, ...]) -> tuple[tuple[str, float], ...]:
    """Pair a vocabulary with the seed's distribution, positionally.

    Raises rather than truncating: a vocabulary that grew without its weights
    would otherwise silently stop generating its newest value, which is exactly
    the drift this module exists to prevent.
    """
    if len(values) != len(weights):
        raise ValueError(
            f"{len(values)} values but {len(weights)} weights: "
            "every value in a vocabulary needs a share of the distribution"
        )
    return tuple(zip(values, weights, strict=True))
