"""Composing the brief: asking the model, or a fallback."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core import llm
from src.core.clock import iso, now
from src.services.ai import usage as ai
from src.services.ai.brief.gathering import FEATURE, MAX_ITEMS, gather

PROMPT = """You write a short daily brief for {name}, who works in Nucleus (an enterprise platform).
Today is {today}. Below, as JSON, is everything waiting on them, and how they usually work.
Rank the {limit} most important items by urgency first (deadlines passed or today, somebody else waiting),
then by how this person usually works (areas they open most). For each, write one short reason a colleague
would say out loud, naming the most important example when there is one.
Answer with JSON only:
{{"headline":"<one sentence on the day>","items":[{{"key":"<key from the input>","title":"<short title>",
"reason":"<one sentence>","urgency":"high"|"medium"|"low"}}]}}
Use only keys from the input. Never invent work or numbers."""


def _fallback(gathered: dict[str, Any]) -> dict[str, Any]:
    picked = gathered["items"][:MAX_ITEMS]
    out = []
    for item in picked:
        first = item["examples"][0]["label"] if item["examples"] else ""
        reason = {
            "acknowledgements": "Somebody is waiting for you to agree to it.",
            "sla": "These are at or past their service level.",
            "overdue": "Past the date it was promised for.",
            "due_soon": "Due before the end of tomorrow.",
            "approvals": "Somebody finished the work and is waiting for your review.",
            "invitations": "The organiser is waiting for your answer.",
            "mentions": "Somebody asked for you by name.",
            "mail": "Unanswered conversations in your inbox.",
            "notifications": "Updates you have not read yet.",
        }.get(item["key"], "Waiting on you.")
        out.append(_item(item, item["title"], f"{reason}" + (f" First: {first}." if first else ""),
                         "high" if item["score"] >= 80 else "medium" if item["score"] >= 55 else "low"))
    total = len(gathered["items"])
    headline = ("Nothing is waiting on you today." if not total else
                f"{total} kind{'s' if total != 1 else ''} of thing waiting on you — start with {out[0]['title'].lower()}.")
    return {"headline": headline, "items": out}


def _item(source: dict[str, Any], title: str, reason: str, urgency: str) -> dict[str, Any]:
    return {"key": source["key"], "title": title[:160], "reason": reason[:300], "link": source["link"],
            "urgency": urgency if urgency in ("high", "medium", "low") else "medium", "count": source["count"],
            "examples": source["examples"][:3], "due": source["due"]}


def _from_model(answer: Any, gathered: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(answer, dict) or not isinstance(answer.get("items"), list):
        return None
    by_key = {i["key"]: i for i in gathered["items"]}
    out, seen = [], set()
    for entry in answer["items"]:
        if not isinstance(entry, dict):
            continue
        source = by_key.get(str(entry.get("key")))
        if source is None or source["key"] in seen:
            continue  # an item the model made up is dropped
        seen.add(source["key"])
        out.append(_item(source, str(entry.get("title") or source["title"]), str(entry.get("reason") or ""),
                         str(entry.get("urgency") or "medium")))
        if len(out) >= MAX_ITEMS:
            break
    if not out and gathered["items"]:
        return None
    return {"headline": str(answer.get("headline") or "")[:300], "items": out}


def _serialise(row) -> dict[str, Any]:
    return {"day": row.day.isoformat(), "headline": row.headline, "items": row.items or [], "source": row.source,
            "model": row.model, "total_tokens": row.total_tokens, "generated_at": iso(row.generated_at)}


def get(session, *, principal, refresh: bool = False) -> dict[str, Any]:
    from src.models.assistant import AssistantBrief

    today = now().date()
    row = session.scalars(select(AssistantBrief).where(AssistantBrief.user_id == principal.user_id,
                                                       AssistantBrief.day == today)).first()
    if row is not None and not refresh:
        return _serialise(row)

    gathered = gather(session, principal)
    brief, source, model, tokens = None, "fallback", None, 0
    if principal.can(ai.AI_PERMISSION) and gathered["items"]:
        if refresh:
            ai.guard(session, principal, FEATURE)
        client = llm.get_client()
        payload = {"waiting": [{k: v for k, v in i.items() if k != "score"} for i in gathered["items"]],
                   "how_they_work": gathered["signals"]}
        import json

        messages = [
            {"role": "system", "content": PROMPT.format(name=principal.full_name, today=now().strftime("%A %d %B"),
                                                        limit=MAX_ITEMS)},
            {"role": "user", "content": json.dumps(payload, default=str)},
        ]
        try:
            result = client.chat(messages, json_mode=True, max_tokens=1200, user=str(principal.user_id))
            ai.record_usage(session, principal, FEATURE, result.usage, model=result.model)
            try:
                brief = _from_model(result.json(), gathered)
            except llm.LlmError:
                brief = None
            if brief is not None:
                source, model, tokens = "ai", result.model, result.usage.total_tokens
        except llm.LlmError:
            ai.record_usage(session, principal, FEATURE, status="error")
    if brief is None:
        brief = _fallback(gathered)
    if not brief["headline"]:
        brief["headline"] = _fallback(gathered)["headline"]

    if row is None:
        row = AssistantBrief(user_id=principal.user_id, day=today)
        session.add(row)
    row.headline = brief["headline"]
    row.items = brief["items"]
    row.source = source
    row.model = model
    row.total_tokens = tokens
    row.generated_at = now()
    session.flush()
    if source == "ai":
        ai.audit(session, principal, resource_type="ai_brief", resource_id=row.id, label="Wrote the daily brief",
                 metadata={"items": len(brief["items"]), "refresh": refresh})
    return _serialise(row)
