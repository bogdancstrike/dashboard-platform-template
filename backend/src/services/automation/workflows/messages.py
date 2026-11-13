"""Actions that tell people: an in-app notification and an email."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.clock import now
from src.core.errors import ValidationError
from src.models.content import EmailMessage, EmailTemplate
from src.models.identity import User
from src.models.platform import AlertRule
from src.services.automation.workflows.actions import Match, _recipient_ids, _text
from src.services.collaboration.automated_mail import next_message_ref


def _notify(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Write an in-app notification, through the service everything else uses."""
    from src.services.collaboration import notifications

    recipients = _recipient_ids(session, config, rule)
    if not recipients:
        raise ValidationError("that notification names nobody to send it to")
    title = _text(str(config.get("title") or "{rule}: {record}"), match, rule)
    body = _text(str(config.get("body") or ""), match, rule)
    for user_id in recipients:
        notifications.publish(
            session,
            user_id=user_id,
            title=title[:240],
            body=body,
            category="ALERT",
            severity=rule.severity,
            link=match.path,
            resource_type=rule.resource_type,
            resource_id=match.id,
            group_key=f"automation:{rule.id}",
            metadata={"rule_id": str(rule.id), "rule": rule.name},
        )
    return f"notified {len(recipients)}"


def _email(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """Queue an email into the platform's own mailbox.

    Deliberately not an SMTP call. There is no mail transport in the template
    and pretending otherwise would make a rule report success for a message
    nobody receives; writing it into `email_messages` puts it where `/mail`
    shows it, which is both honest and inspectable. The subject and body come
    from an `EmailTemplate` when one is named, because that is where the
    platform already keeps its wording (§11).
    """
    recipients = _recipient_ids(session, config, rule)
    if not recipients:
        raise ValidationError("that email names nobody to send it to")
    people = session.scalars(select(User).where(User.id.in_(recipients))).all()

    subject = str(config.get("subject") or "{rule}: {record}")
    body = str(config.get("body") or "")
    code = str(config.get("template") or "").strip()
    if code:
        template = session.scalar(select(EmailTemplate).where(EmailTemplate.code == code))
        if template is None:
            raise ValidationError(f"no email template is called {code!r}")
        subject = template.subject
        body = template.body_text or template.body_html or ""

    message = EmailMessage(
        message_ref=next_message_ref(session),
        subject=_text(subject, match, rule)[:300],
        from_name="Nucleus automation",
        from_email="automation@nucleus.local",
        to_recipients=[{"name": person.full_name, "email": person.email} for person in people],
        body_text=_text(body, match, rule),
        preview=_text(body, match, rule)[:400] or None,
        # OUTBOX and not SENT: nothing has transported it. The folder is the
        # whole claim being made about this row.
        folder="OUTBOX",
        is_read=True,
        priority="HIGH" if rule.severity == "CRITICAL" else "NORMAL",
        owner_id=rule.owner_id,
        sent_at=now(),
    )
    session.add(message)
    session.flush()
    return f"queued to {len(people)}"
