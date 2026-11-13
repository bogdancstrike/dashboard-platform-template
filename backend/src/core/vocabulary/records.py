"""Record vocabularies: priorities, statuses, kinds and segments."""

from __future__ import annotations

Vocabulary = tuple[str, ...]


PRIORITY: Vocabulary = ("LOW", "NORMAL", "HIGH", "CRITICAL")


SEVERITY: Vocabulary = ("MINOR", "MODERATE", "MAJOR", "CRITICAL")


TASK_STATUS: Vocabulary = (
    "NEW", "ASSIGNED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "DONE", "CANCELLED",
)


#: EPIC and STORY are the planning kinds (§18): an epic groups work through
#: `tasks.epic_id`, a story is sized in points.
TASK_KIND: Vocabulary = (
    "TASK", "BUG", "FEATURE", "CHORE", "INCIDENT", "REQUEST", "STORY", "EPIC",
)


TICKET_STATUS: Vocabulary = (
    "OPEN", "ASSIGNED", "IN_PROGRESS", "WAITING_CUSTOMER", "ESCALATED", "RESOLVED", "CLOSED",
)


TICKET_CATEGORY: Vocabulary = (
    "SUPPORT", "BUG", "BILLING", "ACCESS", "PERFORMANCE", "DATA", "FEATURE_REQUEST",
)


TICKET_CHANNEL: Vocabulary = ("EMAIL", "PORTAL", "PHONE", "CHAT", "API")


PROJECT_STATUS: Vocabulary = (
    "ACTIVE", "PLANNING", "ON_HOLD", "COMPLETED", "CANCELLED", "ARCHIVED",
)


PROJECT_PHASE: Vocabulary = ("DISCOVERY", "DESIGN", "EXECUTION", "ROLLOUT", "CLOSURE")


PROJECT_HEALTH: Vocabulary = ("ON_TRACK", "AT_RISK", "OFF_TRACK")


CUSTOMER_STATUS: Vocabulary = ("ACTIVE", "INACTIVE", "BLOCKED")


CUSTOMER_SEGMENT: Vocabulary = ("SMB", "MID_MARKET", "ENTERPRISE", "STRATEGIC")


LIFECYCLE_STAGE: Vocabulary = ("LEAD", "PROSPECT", "CUSTOMER", "RENEWAL", "CHURNED")


ORDER_STATUS: Vocabulary = (
    "PENDING", "CONFIRMED", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED",
)


PAYMENT_STATUS: Vocabulary = ("PAID", "UNPAID", "PARTIAL", "REFUNDED", "OVERDUE")


FULFILMENT_STATUS: Vocabulary = ("PENDING", "SHIPPED", "DELIVERED", "CANCELLED", "RETURNED")


ORDER_CHANNEL: Vocabulary = ("DIRECT", "PORTAL", "PARTNER", "MARKETPLACE", "PHONE")


CURRENCY: Vocabulary = ("EUR", "USD", "GBP")
