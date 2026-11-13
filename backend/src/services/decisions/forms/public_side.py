"""The public form: the challenge, the live form, answers and files."""

from __future__ import annotations

import base64
import hashlib
import hmac
import random
import re
import time
from typing import Any

from sqlalchemy import select

from src.config import Config
from src.core.errors import NotFoundError, UnauthorizedError, ValidationError
from src.models.forms import IntakeForm
from src.services.decisions.forms.field_checks import (
    CHALLENGE_TTL,
    DEFAULT_SETTINGS,
    EMAIL,
    HONEYPOT,
    MANAGE,
    MAX_FILE_BYTES,
)


def _sign(payload: str) -> str:
    return hmac.new(Config.SECRET_KEY.encode(), payload.encode(), hashlib.sha256).hexdigest()[:32]


def challenge(slug: str) -> dict[str, Any]:
    a, b = random.randint(2, 9), random.randint(2, 9)
    expires = int(time.time()) + CHALLENGE_TTL
    payload = f"{slug}:{a + b}:{expires}"
    return {"question": f"What is {a} + {b}?", "token": f"{expires}.{_sign(payload)}"}


def _check_challenge(slug: str, token: Any, answer: Any) -> None:
    try:
        expires_raw, signature = str(token).split(".", 1)
        expires = int(expires_raw)
        expected = _sign(f"{slug}:{int(str(answer).strip())}:{expires}")
    except (TypeError, ValueError) as exc:
        raise ValidationError("Answer the question to show you are a person.",
                              details={"field": "captcha"}) from exc
    if expires < time.time() or not hmac.compare_digest(expected, signature):
        raise ValidationError("That answer is not right — try again.", details={"field": "captcha"})


def _live(session, slug: str, principal) -> IntakeForm:
    row = session.scalars(select(IntakeForm).where(IntakeForm.slug == str(slug).lower(),
                                                   IntakeForm.deleted_at.is_(None))).first()
    if row is None or row.status == "DRAFT" and not (principal and principal.can(MANAGE)):
        raise NotFoundError("This form does not exist.")
    settings = {**DEFAULT_SETTINGS, **(row.settings or {})}
    if settings["visibility"] == "INTERNAL" and principal is None:
        raise UnauthorizedError("Sign in to use this form.", details={"visibility": "INTERNAL"})
    return row


def public_form(session, slug: str, *, principal) -> dict[str, Any]:
    row = _live(session, slug, principal)
    settings = {**DEFAULT_SETTINGS, **(row.settings or {})}
    return {
        "name": row.name, "slug": row.slug, "description": row.description or "",
        "status": row.status, "open": row.status == "PUBLISHED",
        "fields": [{key: value for key, value in field.items() if key != "map_to"} for field in row.fields or []],
        "submit_label": settings["submit_label"], "visibility": settings["visibility"],
        "challenge": challenge(row.slug) if settings["captcha"] and principal is None else None,
        "honeypot": HONEYPOT,
    }


def _visible(field: dict[str, Any], answers: dict[str, Any]) -> bool:
    rule = field.get("visible_when")
    if not rule:
        return True
    value = answers.get(rule["field"])
    expected = rule.get("equals")
    if isinstance(value, list):
        return expected in value
    return value == expected if expected not in (None, "") else bool(value)


def _clean_answers(session, form: IntakeForm, raw: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    answers: dict[str, Any] = {}
    files: list[dict[str, Any]] = []
    problems: dict[str, str] = {}
    for field in form.fields or []:
        if field["type"] == "heading":
            continue
        if not _visible(field, answers):
            continue
        value = raw.get(field["id"])
        empty = value in (None, "", []) or (isinstance(value, dict) and not value.get("data"))
        if empty:
            if field.get("required"):
                problems[field["id"]] = f"{field['label']} is required."
            continue
        kind = field["type"]
        if kind == "email" and not EMAIL.match(str(value)):
            problems[field["id"]] = "That does not look like an email address."
        elif kind == "number":
            try:
                value = float(value)
                value = int(value) if value.is_integer() else value
            except (TypeError, ValueError):
                problems[field["id"]] = "A number is needed."
        elif kind == "rating":
            try:
                value = int(value)
                if not 1 <= value <= int(field.get("max") or 5):
                    raise ValueError
            except (TypeError, ValueError):
                problems[field["id"]] = "Choose a rating."
        elif kind == "select" and str(value) not in field.get("options", []):
            problems[field["id"]] = "Choose one of the options."
        elif kind == "multiselect":
            value = [str(item) for item in (value if isinstance(value, list) else [value])]
            if any(item not in field.get("options", []) for item in value):
                problems[field["id"]] = "Choose from the options."
        elif kind == "file":
            stored = _store_file(form, value)
            if isinstance(stored, str):
                problems[field["id"]] = stored
            else:
                files.append({"field": field["id"], **stored})
                value = stored["name"]
        elif kind in ("text", "textarea", "email", "date"):
            value = str(value)[: 5000 if kind == "textarea" else 500]
        answers[field["id"]] = value
    if problems:
        raise ValidationError("Some answers need another look.", details={"fields": problems})
    return answers, files


def _store_file(form: IntakeForm, value: Any) -> dict[str, Any] | str:
    from src.core import storage

    if not isinstance(value, dict):
        return "Attach a file."
    name = str(value.get("name") or "attachment")[:180]
    data = str(value.get("data") or "")
    if "," in data:
        data = data.split(",", 1)[1]
    try:
        blob = base64.b64decode(data, validate=True)
    except (ValueError, TypeError):
        return "The file could not be read."
    if len(blob) > MAX_FILE_BYTES:
        return f"Files may be at most {MAX_FILE_BYTES // (1024 * 1024)} MB."
    try:
        storage.refuse_unacceptable(name, len(blob))
    except ValidationError as exc:
        return exc.message
    key = storage.key_for("forms", str(form.id), hashlib.sha256(blob).hexdigest()[:24],
                          re.sub(r"[^A-Za-z0-9._-]", "_", name))
    stored = storage.for_config().put(key, blob, content_type=storage.content_type_for(name))
    return {"name": name, "key": stored.key, "size": stored.size_bytes}
