"""What needs attention now (§66)."""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from src.core.clock import now
from src.services.analytics.overview.measures import _count


def alerts(session) -> list[dict[str, Any]]:
    """The operational exceptions, each with the list that explains it.

    An alert you cannot act on is noise, so every one of these carries a link
    to the records behind it. Only non-zero counts are returned — a dashboard
    that permanently shows "0 failed jobs" has trained everyone to ignore it.
    """
    from src.models.business import Device, Task, Ticket
    from src.models.identity import SecurityEvent
    from src.models.platform import BackgroundJob, ServiceHealth

    moment = now()
    out: list[dict[str, Any]] = []

    def add(key, severity, count, singular, plural, link, icon):
        """Both wordings, because a count of one is not a rare case here.

        "1 services are degraded" is the kind of detail that makes an operator
        trust the rest of the screen slightly less.
        """
        if not count:
            return
        template = singular if count == 1 else plural
        out.append({
            "key": key, "severity": severity, "count": int(count),
            "message": template.format(count=count), "link": link, "icon": icon,
        })

    add("failed_jobs", "CRITICAL",
        _count(session, BackgroundJob, BackgroundJob.status == "FAILED",
               BackgroundJob.created_at >= moment - timedelta(days=1)),
        "{count} background job failed in the last 24 hours",
        "{count} background jobs failed in the last 24 hours",
        "/admin/jobs?status=FAILED", "x-circle")

    add("degraded_services", "WARNING",
        _count(session, ServiceHealth, ServiceHealth.status.in_(("DEGRADED", "UNAVAILABLE"))),
        "{count} service is degraded or unavailable",
        "{count} services are degraded or unavailable",
        "/admin/health", "activity")

    add("overdue_tasks", "WARNING",
        _count(session, Task, ~Task.status.in_(("DONE", "CANCELLED")), Task.due_date < moment),
        "{count} task is past its due date",
        "{count} tasks are past their due date",
        "/tasks?overdue=true", "clock")

    add("sla_breaches", "CRITICAL",
        _count(session, Ticket, Ticket.sla_breached.is_(True),
               ~Ticket.status.in_(("RESOLVED", "CLOSED"))),
        "{count} open ticket has breached its SLA",
        "{count} open tickets have breached their SLA",
        "/tickets?sla_breached=true", "alert-triangle")

    add("devices_offline", "WARNING",
        _count(session, Device, Device.status == "OFFLINE"),
        "{count} device has stopped reporting",
        "{count} devices have stopped reporting",
        "/devices?status=OFFLINE", "cpu")

    add("security_events", "CRITICAL",
        _count(session, SecurityEvent, SecurityEvent.resolved.is_(False),
               SecurityEvent.severity == "CRITICAL"),
        "{count} unresolved critical security event",
        "{count} unresolved critical security events",
        "/settings/security", "shield")

    order = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}
    out.sort(key=lambda alert: (order.get(alert["severity"], 3), -alert["count"]))
    return out
