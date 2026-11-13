"""What an action works with: the matched record, the action type, and the text and people it fills in."""

from __future__ import annotations

import re
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any, Callable
from uuid import UUID

from sqlalchemy import func, select

from src.core.naming import identifier, sequence_of
from src.core.pagination import parse_uuid
from src.models.business import Task
from src.models.identity import User
from src.models.platform import AlertRule

#: Holding this is what separates somebody who reads the automations from
#: somebody who can make the platform email forty people. Reading the list
#: needs it too: a rule's condition names the fields and values of records the
#: reader may not be able to see.
PERMISSION = "automations.manage"


#: An unreachable webhook must not hold a request open. Short, because this
#: runs inside the "run now" call until scheduling exists (§23).
WEBHOOK_TIMEOUT_SECONDS = 5


SEVERITIES = ("INFO", "WARNING", "CRITICAL")


#: `{record}` and friends in an action's text. A whitelist substitution rather
#: than `str.format_map`, which would let `{record.__class__}` reach into the
#: object graph from a field somebody typed.
_PLACEHOLDER = re.compile(r"\{([a-z_]+)\}")


@dataclass(frozen=True)
class Match:
    """One record a rule matched, reduced to what an action needs of it."""

    id: str
    label: str
    path: str
    row: Any


@dataclass(frozen=True)
class Action:
    """One kind of thing a rule can do.

    `needs` is what the editor must ask for and what `validate` insists on, in
    one place — a field the engine reads and the form never offers is a rule
    that cannot work, and the opposite is a form asking for something nothing
    uses.
    """

    kind: str
    label: str
    description: str
    needs: tuple[str, ...] = ()
    run: Callable[..., str] = dataclass_field(default=lambda **_: "")


def _text(template: str, match: Match, rule: AlertRule) -> str:
    """Fill `{record}`, `{rule}` and `{link}` in an action's own wording."""
    values = {
        "record": match.label,
        "rule": rule.name,
        "link": match.path,
        "severity": rule.severity,
    }
    return _PLACEHOLDER.sub(lambda hit: values.get(hit.group(1), hit.group(0)), template or "")


def _owner_principal(session, rule: AlertRule):
    """Who an automation writes records *as*: its author, labelled as the rule.

    Records an automation changes are audited to the person who wrote it —
    somebody has to answer for "why did this ticket's priority change at three
    in the morning" — with the rule's name beside them so the ledger says it
    was the rule and not them at the keyboard.
    """
    from src.core.auth import Principal

    owner = rule.owner
    return Principal(
        user_id=owner.id if owner else None, subject="", email=owner.email if owner else "",
        username=f"automation:{rule.id}", full_name=f"{rule.name} (automation)"[:160],
        role_code="SYSTEM",
        permissions=frozenset({"records.view", "records.create", "records.update"}),
    )


def _recipient_ids(session, config: dict[str, Any], rule: AlertRule) -> list[UUID]:
    """Resolve a recipient declaration to user ids, at the moment of firing.

    Resolved now and never stored: the point of addressing a *role* is that the
    answer changes as the team does — a rule addressed to whoever holds
    MANAGER must reach the person who joined last week.
    """
    spec = config.get("recipients")
    spec = spec if isinstance(spec, dict) else {}
    ids: list[UUID] = []

    for raw in spec.get("user_ids") or []:
        ids.append(parse_uuid(raw, field="recipients"))

    role = str(spec.get("role") or "").strip().upper()
    if role:
        from src.models.identity import Role

        ids.extend(
            session.scalars(
                select(User.id)
                .join(Role, User.role_id == Role.id)
                .where(Role.code == role, User.status == "ACTIVE", User.deleted_at.is_(None))
            ).all()
        )

    if spec.get("owner") and rule.owner_id:
        ids.append(rule.owner_id)

    seen: dict[UUID, None] = {}
    for item in ids:
        seen.setdefault(item, None)
    return list(seen)


def _next_task_reference(session) -> str:
    """The next `TSK-00042`, counted the way the task service counts it."""
    latest = session.scalar(
        select(func.max(Task.reference)).where(Task.reference.like("TSK-%"))
    )
    return identifier("TSK", sequence_of(latest, prefix="TSK") + 1)
