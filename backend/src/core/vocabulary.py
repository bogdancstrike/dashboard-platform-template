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
