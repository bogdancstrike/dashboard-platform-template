"""The closed value sets of the domain, declared once.
See docs/architecture/backend/vocabulary.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "records": (
        "Vocabulary", "PRIORITY", "SEVERITY", "TASK_STATUS", "TASK_KIND", "TICKET_STATUS",
        "TICKET_CATEGORY", "TICKET_CHANNEL", "PROJECT_STATUS", "PROJECT_PHASE", "PROJECT_HEALTH",
        "CUSTOMER_STATUS", "CUSTOMER_SEGMENT", "LIFECYCLE_STAGE", "ORDER_STATUS", "PAYMENT_STATUS",
        "FULFILMENT_STATUS", "ORDER_CHANNEL", "CURRENCY",
    ),
    "estate": (
        "DEVICE_KIND", "DEVICE_STATUS", "NOTIFICATION_CATEGORY", "NOTIFICATION_SEVERITY",
        "EMAIL_FOLDER", "EMAIL_SEEDED_FOLDER", "EMAIL_PRIORITY", "EVENT_CATEGORY", "EVENT_STATUS",
        "EVENT_RESPONSE", "EVENT_FREQUENCY", "USER_STATUS", "INTEGRATION_STATUS",
        "INTEGRATION_CATEGORY", "API_CLIENT_STATUS", "API_CREDENTIAL_STATE", "ORG_TIER",
        "ORG_STATUS", "GROUP_KIND",
    ),
    "operations": (
        "LOG_LEVEL", "JOB_KIND", "JOB_STATUS", "JOB_TERMINAL", "JOB_CANCELLABLE", "IMPORT_STATUS",
        "IMPORT_OPEN", "LOGIN_RESULT", "LOGIN_METHOD", "SESSION_STATE", "SECURITY_SEVERITY",
        "IMPORT_COUNTED", "IMPORT_STEP", "QUALITY_SEVERITY", "weighted",
    ),
})
