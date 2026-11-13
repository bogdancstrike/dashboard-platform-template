"""References for mail the platform sends on its own behalf (automations, watches)."""

from __future__ import annotations

from sqlalchemy import func, select

from src.core.naming import identifier, sequence_of
from src.models.content import EmailMessage


def next_message_ref(session) -> str:
    """`AUTO-000123`: the next number in the automated-mail sequence."""
    latest = session.scalar(
        select(func.max(EmailMessage.message_ref)).where(EmailMessage.message_ref.like("AUTO-%"))
    )
    return identifier("AUTO", sequence_of(latest, prefix="AUTO") + 1, width=6)
