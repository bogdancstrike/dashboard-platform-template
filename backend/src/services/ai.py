"""What every AI feature does around a model call (§41–46).

* :func:`guard` — the permission (``ai.use``) and the per-user rate limit,
  checked before any work is done;
* :func:`record_usage` — one ``ai_usage`` row per model call, whether it
  succeeded or not, so the limit counts attempts and the totals are honest;
* :func:`audit` — one audit-log row per request a person made of the model,
  without an activity-feed entry (asking a question is not news).

Shared by the assistant, the filter compiler, the daily brief and page help;
the Knowledge & Insights features can use it the same way.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlalchemy import func, select

from src.config import Config
from src.core import llm
from src.core.clock import now
from src.core.errors import RateLimitedError, ServiceUnavailableError

AI_PERMISSION = "ai.use"


def guard(session, principal, feature: str) -> None:
    """Refuse before any work: no permission, or too many calls this minute."""
    from src.models.assistant import AiUsage

    principal.require(AI_PERMISSION)
    limit = max(1, Config.LLM_RATE_PER_MINUTE)
    recent = session.scalar(
        select(func.count())
        .select_from(AiUsage)
        .where(AiUsage.user_id == principal.user_id, AiUsage.created_at > now() - timedelta(minutes=1))
    )
    if (recent or 0) >= limit:
        raise RateLimitedError(
            "You are asking the assistant faster than it can answer. Try again in a minute.",
            details={"limit_per_minute": limit, "feature": feature},
        )


def record_usage(
    session,
    principal,
    feature: str,
    usage: llm.Usage | None = None,
    *,
    model: str | None = None,
    status: str = "ok",
):
    from src.models.assistant import AiUsage

    usage = usage or llm.Usage()
    row = AiUsage(
        user_id=principal.user_id if principal else None,
        feature=feature[:32],
        model=(model or llm.get_client().model or "")[:80],
        status=status[:16],
        prompt_tokens=usage.prompt_tokens,
        completion_tokens=usage.completion_tokens,
        total_tokens=usage.total_tokens,
        latency_ms=usage.latency_ms,
        created_at=now(),
    )
    session.add(row)
    return row


def audit(
    session,
    principal,
    *,
    action: str = "AI_REQUEST",
    resource_type: str,
    resource_id: Any = None,
    label: str = "",
    metadata: dict[str, Any] | None = None,
    result: str = "SUCCESS",
) -> None:
    from src.core import audit as trail

    trail.record(
        session,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_label=label[:255],
        principal=principal,
        result=result,
        metadata=metadata,
        message=label[:500],
        activity=False,
    )


def unavailable(exc: llm.LlmError) -> ServiceUnavailableError:
    """A model failure, as the API reports it — never the provider's words."""
    friendly = {
        "LLM_RATE_LIMITED": "The AI service is busy right now. Try again in a moment.",
        "LLM_BUSY": "The assistant is busy right now — try again in a moment.",
        "LLM_TIMEOUT": "The assistant took too long — try again.",
        "LLM_AUTH": "The AI service is not configured on this server.",
    }.get(exc.code, "The AI service could not answer just now. Try again.")
    return ServiceUnavailableError(friendly, details={"code": exc.code})


def status() -> dict[str, Any]:
    """What the UI may say about the model: whether it is real, and which."""
    client = llm.get_client()
    return {"mode": llm.mode(), "model": client.model, "real": not client.is_fake}
