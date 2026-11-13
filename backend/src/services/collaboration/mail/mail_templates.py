"""Mail templates, and rendering one with its placeholders filled."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from src.core.errors import NotFoundError
from src.models.content import EmailTemplate
from src.services.collaboration.mail.rows import _PLACEHOLDER, _me
from src.services.collaboration.mail.serializers import _as_text


def templates(session, *, principal) -> dict[str, Any]:
    """The composer's wording, from the templates an administrator maintains.

    Read here rather than from `/admin/email-templates`, which is privileged:
    somebody with a mailbox should be able to use a template without being
    able to edit one (§11, §16).
    """
    _me(principal)
    rows = session.scalars(
        select(EmailTemplate)
        .where(EmailTemplate.is_active.is_(True), EmailTemplate.deleted_at.is_(None))
        .order_by(EmailTemplate.category, EmailTemplate.name)
    ).all()
    return {
        "items": [
            {
                "code": row.code,
                "name": row.name,
                "description": row.description,
                "category": row.category,
                "subject": row.subject,
                "body": row.body_text or _as_text(row.body_html),
                "variables": list(row.variables or []),
            }
            for row in rows
        ],
        "total": len(rows),
    }


def render_template(session, code: str, values: dict[str, Any], *, principal):
    """Fill a template's placeholders, on the server.

    Here and not in the browser because the *substitution rule* is a fact
    about a template: `{{ name }}` and `{{name}}` are the same placeholder, an
    unknown one is left alone rather than blanked, and a second implementation
    would disagree about both the first time somebody wrote a space.
    """
    _me(principal)
    return _rendered(_template_row(session, code), values)


def _template_row(session, code: str) -> EmailTemplate:
    row = session.scalar(
        select(EmailTemplate).where(
            EmailTemplate.code == str(code or ""), EmailTemplate.deleted_at.is_(None)
        )
    )
    if row is None:
        raise NotFoundError("That template does not exist.")
    return row


def _rendered(row: EmailTemplate, values: dict[str, Any] | None) -> dict[str, Any]:
    """The substitution itself, with no permission check.

    Separate from `render_template` so the composer can use a template without
    this module needing a stand-in principal to satisfy its own endpoint — the
    caller has checked `mail.access` already, and re-checking it for somebody
    who has just used it is a check that only ever fails by accident.
    """
    known = {str(key): str(value) for key, value in (values or {}).items()}

    def fill(text: str | None) -> str:
        return _PLACEHOLDER.sub(lambda hit: known.get(hit.group(1), hit.group(0)), text or "")

    body = row.body_text or _as_text(row.body_html)
    return {
        "code": row.code,
        "subject": fill(row.subject),
        "body": fill(body),
        # Which placeholders were not supplied, so the composer can say so
        # before somebody sends "Dear {{ name }}" to a customer (§76).
        "unfilled": sorted(
            {
                hit
                for text in (row.subject, body)
                for hit in _PLACEHOLDER.findall(text)
                if hit not in known
            }
        ),
    }
