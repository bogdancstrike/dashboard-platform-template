"""One channel; creating, direct messages, changing, archiving, joining."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlalchemy import select

from src.core.clock import iso, now
from src.core.errors import ConflictError, ForbiddenError, ValidationError
from src.services.collaboration.chat.access import (
    USE,
    VISIBILITIES,
    _channel,
    _member,
    _slug,
    _taken,
    _topic,
    _users,
    audience,
    authorise_read,
    authorise_write,
)
from src.services.collaboration.chat.channel_list import _people, _summary, _unread


def detail(session, channel_id: Any, *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    me = principal.user_id
    membership = _member(row, me)
    unread = _unread(session, me, [row.id]).get(str(row.id), (0, 0))
    summary = _summary(row, principal, unread, None)
    return {
        **summary,
        "members": _people(row, me),
        "created_at": iso(row.created_at),
        "can_manage": _may_manage(row, principal),
        "can_post": principal.can(USE) and row.archived_at is None
        and (membership is not None or row.visibility == "PUBLIC"),
    }


def create(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    from src.models.collab import ChatChannel, ChatMember

    principal.require(USE)
    if not isinstance(payload, dict):
        raise ValidationError("The channel must be a JSON object.")
    name = _slug(payload.get("name"))
    if _taken(session, name):
        raise ConflictError(f"There is already a channel called #{name}.", details={"field": "name"})
    visibility = str(payload.get("visibility") or "PUBLIC").upper()
    if visibility not in VISIBILITIES:
        raise ValidationError("visibility must be PUBLIC or PRIVATE.", details={"field": "visibility"})

    row = ChatChannel(
        name=name, topic=_topic(payload.get("topic")), kind="CHANNEL", visibility=visibility,
        created_by_id=principal.user_id, organization_id=principal.organization_id,
    )
    row.members.append(ChatMember(user_id=principal.user_id, role="OWNER"))
    for user_id in _users(session, payload.get("member_ids")):
        if user_id != principal.user_id:
            row.members.append(ChatMember(user_id=user_id, role="MEMBER"))
    session.add(row)
    session.flush()
    _changed(session, row)
    return detail(session, row.id, principal=principal)


def direct(session, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    """The conversation with one other person — found if it exists, else begun."""
    from src.models.collab import ChatChannel, ChatMember

    principal.require(USE)
    people = _users(session, [(payload or {}).get("user_id")])
    other = people[0]
    pair = sorted({str(other), str(principal.user_id)})
    key = ":".join(pair)
    row = session.scalars(select(ChatChannel).where(ChatChannel.direct_key == key)).one_or_none()
    if row is None:
        row = ChatChannel(name="direct", kind="DIRECT", visibility="PRIVATE", direct_key=key,
                          created_by_id=principal.user_id)
        for person in pair:
            row.members.append(ChatMember(user_id=UUID(person), role="MEMBER"))
        session.add(row)
        session.flush()
    return detail(session, row.id, principal=principal)


def _may_manage(row, principal) -> bool:
    if row.kind == "DIRECT":
        return False
    membership = _member(row, principal.user_id)
    return principal.is_admin or (membership is not None and membership.role == "OWNER")


def update(session, channel_id: Any, payload: dict[str, Any], *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    if not _may_manage(row, principal):
        raise ForbiddenError("Only the channel's owner can change it.")
    payload = payload or {}
    if "name" in payload:
        name = _slug(payload.get("name"))
        if _taken(session, name, except_id=row.id):
            raise ConflictError(f"There is already a channel called #{name}.", details={"field": "name"})
        row.name = name
    if "topic" in payload:
        row.topic = _topic(payload.get("topic"))
    if "muted" in payload:
        membership = _member(row, principal.user_id)
        if membership is not None:
            membership.muted = bool(payload.get("muted"))
    session.flush()
    _changed(session, row)
    return detail(session, row.id, principal=principal)


def archive(session, channel_id: Any, *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    row = _channel(session, channel_id)
    if not _may_manage(row, principal):
        raise ForbiddenError("Only the channel's owner can archive it.")
    row.archived_at = now()
    session.flush()
    _changed(session, row)
    return {"archived": True, "id": str(row.id)}


def join(session, channel_id: Any, *, principal) -> dict[str, Any]:
    authorise_read(session, channel_id, principal)
    authorise_write(session, channel_id, principal)
    row = _channel(session, channel_id)
    _changed(session, row)
    return detail(session, channel_id, principal=principal)


def _changed(session, row, also: list[str] | None = None) -> None:
    """Tell the members the room itself changed: its name, its people."""
    from src.services.collaboration import live

    payload = {"type": "chat.channel", "channel_id": str(row.id)}
    try:
        if row.visibility == "PUBLIC" and row.kind == "CHANNEL":
            live.publish_to_all(payload)
            return
        for person in {*audience(session, row.id), *(also or [])}:
            live.publish_to_user(person, payload)
    except Exception:  # pragma: no cover - best-effort by contract
        pass
