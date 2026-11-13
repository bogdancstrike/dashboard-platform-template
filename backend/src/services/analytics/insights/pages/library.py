"""Saved insights: list, one, save; who sees them."""

from __future__ import annotations

from typing import Any

from sqlalchemy import and_, or_, select

from src.core import audit, sharing
from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.core.pagination import parse_uuid
from src.core.repository import found_or_404
from src.services.analytics.insights import spec as specs
from src.services.analytics.insights import suggestions as suggestions
from src.services.analytics.insights.pages.tools import (
    KIND,
    MAX_QUESTION,
    SHARE_PERMISSION,
    USE_PERMISSION,
    _catalogue,
)
from src.services.records import explorer


def _visible(principal):
    from src.models.insights import Insight

    return and_(Insight.deleted_at.is_(None), sharing.visibility(Insight, KIND, principal))


def _row(session, ident: Any, principal):
    from src.models.insights import Insight

    identifier = parse_uuid(ident, field="insight_id")
    row = found_or_404(
        session.scalars(select(Insight).where(Insight.id == identifier, _visible(principal))).first(),
        "That insight does not exist.",
        details={"id": str(identifier)},
    )
    return row


def serialize(row, principal, *, full: bool = True, members=None) -> dict[str, Any]:
    out = {
        "id": str(row.id),
        "title": row.title,
        "question": row.question,
        "summary": row.summary or "",
        "datasets": list(row.datasets or []),
        "source": row.source,
        "model": row.model,
        "scope": row.scope,
        "pinned": bool(row.pinned),
        "owner": {"id": str(row.owner_id) if row.owner_id else None, "name": row.owner.full_name if row.owner else ""},
        "can_edit": row.owner_id == principal.user_id,
        "refreshed_at": iso(row.refreshed_at),
        "created_at": iso(row.created_at),
        "updated_at": iso(row.updated_at),
        "kinds": [node["type"] for node in (row.spec or {}).get("blocks", [])][:12],
    }
    if full:
        out.update({"spec": row.spec, "rendered": row.rendered, "warnings": list(row.warnings or [])})
    if members is not None:
        out["members"] = members
    return out


def listing(session, args: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.insights import Insight

    principal.require(USE_PERMISSION)
    statement = select(Insight).where(_visible(principal))
    text = str(args.get("q") or "").strip()
    if text:
        statement = statement.where(or_(Insight.title.ilike(f"%{text}%"), Insight.question.ilike(f"%{text}%")))
    if str(args.get("scope") or "") == "mine":
        statement = statement.where(Insight.owner_id == principal.user_id)
    rows = session.scalars(
        statement.order_by(Insight.pinned.desc(), Insight.updated_at.desc()).limit(200)
    ).unique().all()
    return {
        "items": [serialize(row, principal, full=False) for row in rows],
        "suggestions": suggestions.for_viewer(principal, explorer.resources()),
        "datasets": [{"key": d["dataset"], "label": d["label"]} for d in _catalogue(principal)],
        "can_share": principal.can(SHARE_PERMISSION),
    }


def detail(session, ident: Any, args: dict[str, Any] | None = None, *, principal) -> dict[str, Any]:
    """One insight. `fresh=true` binds its queries now, for this reader, without storing."""
    principal.require(USE_PERMISSION)
    row = _row(session, ident, principal)
    out = serialize(row, principal, members=sharing.members(session, KIND, row.id))
    if str((args or {}).get("fresh") or "").lower() in ("1", "true", "yes"):
        rendered, errors = specs.bind(session, row.spec, principal=principal)
        out.update({"rendered": rendered, "warnings": errors, "refreshed_at": iso(now())})
    return out


def save(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """Keep a draft: its spec is validated and bound again, never trusted."""
    from src.models.insights import Insight

    principal.require(USE_PERMISSION)
    payload = payload if isinstance(payload, dict) else {}
    question = str(payload.get("question") or "").strip()[:MAX_QUESTION]
    if not question:
        raise ValidationError("An insight needs the question it answers.", details={"field": "question"})
    try:
        spec, dropped = specs.validate(payload.get("spec"))
    except specs.SpecError as exc:
        raise ValidationError(str(exc), details={"field": "spec"}) from exc
    title = str(payload.get("title") or spec["title"]).strip()[:200] or "Insight"
    spec["title"] = title
    rendered, errors = specs.bind(session, spec, principal=principal)
    scope = sharing.scope_of(payload.get("scope"), principal=principal, share_permission=SHARE_PERMISSION)
    source = payload.get("source") if payload.get("source") in ("ai", "suggested", "fallback") else "ai"
    row = Insight(title=title, question=question, summary=spec["summary"] or None,
                  datasets=specs.queries_of(spec), spec=spec, rendered=rendered, warnings=dropped + errors or None,
                  source=source, model=str(payload.get("model") or "")[:80] or None,
                  usage=payload.get("usage") if isinstance(payload.get("usage"), dict) else None,
                  scope=scope, pinned=bool(payload.get("pinned")), refreshed_at=now(),
                  owner_id=principal.user_id, organization_id=principal.organization_id)
    session.add(row)
    session.flush()
    if scope == "SHARED":
        sharing.replace_members(session, KIND, row.id, sharing.requested_members(payload),
                                principal=principal, owner_id=row.owner_id)
    audit.record(session, action="CREATE", resource_type="insight", resource_id=row.id, resource_label=title,
                 principal=principal, after={"title": title, "scope": scope}, message=f"saved insight {title}")
    session.flush()
    return detail(session, row.id, principal=principal)
