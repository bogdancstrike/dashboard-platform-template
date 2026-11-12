"""“Ask about this page” — the adaptive tour (§46).

The browser sends what it knows about the page the reader is on: the tour's
stops, the commands registered for it (the command palette's registry) and
the controls visible on screen, each by its ``data-testid``. The model answers
the how-to question in that context, may point at one control, and may
*propose* one command. It never runs anything: the browser asks the reader to
confirm, runs the command itself, and reports it back here for the audit log.

Whatever the model names is checked against what was sent — a control or a
command that is not on the page is dropped, never shown.
"""

from __future__ import annotations

import json
import re
from typing import Any

from src.core import llm
from src.core.errors import ValidationError
from src.services import ai

FEATURE = "page-help"
MAX_QUESTION = 500

PROMPT = """You are the in-app guide of Nucleus, an enterprise platform. The user is on the page {path}.
Answer their "how do I…" question about THIS page in two to four short sentences of Markdown, using the
page's own words for its controls. Below is what is on the page:
- tour: the guided tour's stops (target = a control id; description says why it matters)
- controls: controls visible right now, by id and label
- commands: actions that can be run for the user, by id
If one control is the answer, set "highlight" to its id. If one command does what they asked, set "action"
to its id — it will only run after they confirm. Never name an id that is not listed.
Answer with JSON only: {{"answer":"…","highlight":"<control id>"|null,"action":"<command id>"|null}}"""


def _items(raw: Any, keys: tuple[str, ...], limit: int) -> list[dict[str, str]]:
    out = []
    for entry in raw if isinstance(raw, list) else []:
        if isinstance(entry, dict):
            item = {k: str(entry.get(k) or "")[:300] for k in keys}
            if item[keys[0]]:
                out.append(item)
        if len(out) >= limit:
            break
    return out


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{3,}", text.lower()) if w not in {"how", "the", "and", "can", "this", "what", "page"}}


def _best(question: str, candidates: list[dict[str, str]], fields: tuple[str, ...]) -> dict[str, str] | None:
    wanted = _words(question)
    scored = [(len(wanted & _words(" ".join(c.get(f, "") for f in fields))), c) for c in candidates]
    scored = [s for s in scored if s[0] > 0]
    return max(scored, key=lambda s: s[0])[1] if scored else None


def ask(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise ValidationError("The request must be a JSON object.")
    question = str(payload.get("question") or "").strip()
    if not question:
        raise ValidationError("Ask a question about this page.", details={"field": "question"})
    if len(question) > MAX_QUESTION:
        raise ValidationError(f"Keep the question under {MAX_QUESTION} characters.")
    path = str(payload.get("path") or "/")[:200]
    ai.guard(session, principal, FEATURE)

    stops = _items(payload.get("stops"), ("title", "description", "target"), 20)
    controls = _items(payload.get("controls"), ("id", "label"), 80)
    commands = _items(payload.get("commands"), ("id", "label", "keywords"), 60)
    control_ids = {c["id"] for c in controls} | {s["target"] for s in stops if s["target"]}
    by_command = {c["id"]: c for c in commands}

    answer, highlight, action, source = "", None, None, "ai"
    messages = [
        {"role": "system", "content": PROMPT.format(path=path)},
        {"role": "user", "content": json.dumps({"tour": stops, "controls": controls, "commands": commands})},
        {"role": "user", "content": question},
    ]
    try:
        result = llm.get_client().chat(messages, json_mode=True, max_tokens=800, user=str(principal.user_id))
        ai.record_usage(session, principal, FEATURE, result.usage, model=result.model)
        parsed = result.json()
        if isinstance(parsed, dict):
            answer = str(parsed.get("answer") or "").strip()
            highlight = str(parsed.get("highlight") or "") or None
            action = str(parsed.get("action") or "") or None
    except llm.LlmError as exc:
        if exc.code != "LLM_BAD_OUTPUT":
            ai.record_usage(session, principal, FEATURE, status="error")

    if highlight not in control_ids:
        highlight = None
    if action not in by_command:
        action = None
    if not answer:
        # Without the model: the tour stop and the command whose words match best.
        source = "fallback"
        stop = _best(question, stops, ("title", "description"))
        command = _best(question, commands, ("label", "keywords"))
        if stop:
            answer = f"**{stop['title']}.** {stop['description']}"
            highlight = highlight or (stop["target"] or None)
        elif command:
            answer = f"You can do that from here: **{command['label']}**."
        else:
            answer = "I could not find that on this page. Try the tour, or the command palette (Ctrl K)."
        action = action or (command["id"] if command else None)

    ai.audit(session, principal, resource_type="page_help", label=f"Asked about {path}",
             metadata={"path": path, "question": question[:300], "action": action, "source": source})
    return {
        "answer": answer,
        "highlight": highlight,
        "action": {"id": action, "label": by_command[action]["label"]} if action else None,
        "source": source,
    }


def confirm(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Record that the reader confirmed a proposed action and it ran."""
    principal.require(ai.AI_PERMISSION)
    if not isinstance(payload, dict) or not str(payload.get("command_id") or "").strip():
        raise ValidationError("Which command ran?", details={"field": "command_id"})
    command = str(payload["command_id"])[:120]
    label = str(payload.get("label") or command)[:200]
    path = str(payload.get("path") or "")[:200]
    ai.audit(session, principal, action="AI_ACTION", resource_type="page_help", resource_id=command,
             label=f"Ran “{label}” on {path or 'a page'}, as the assistant proposed",
             metadata={"command_id": command, "path": path})
    return {"recorded": True}
