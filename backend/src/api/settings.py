"""System settings and feature flags (§11, §27).

A setting is addressed by its **key** and written one at a time: the audit row
then names exactly what changed, and a refusal names the setting it refused. A
bulk write of a configuration document audits as "the settings changed", which
is the least useful thing an audit trail can say.

Flags carry create and delete as well, because a flag belongs to a piece of
work rather than to the platform — it arrives when the work starts and goes
when the work has shipped.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services import settings as service


@requires("settings.manage")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every setting, grouped, with what the platform ships with beside it."""
    principal = me()
    args = request.args.to_dict() if request is not None else {}
    with session_scope() as session:
        return service.settings(session, args, principal=principal), 200


@requires("settings.manage")
def item(app=None, operation: str = "", request=None, key: str = "", **kwargs: Any):
    """Change one setting, or reset it to its default."""
    principal = me()
    identifier = key or str(kwargs.get("key") or "")
    with session_scope() as session:
        return service.update_setting(session, identifier, json_body(), principal=principal), 200


@requires("flags.manage")
def flags(app=None, operation: str = "", request=None, **_: Any):
    """Every flag and whether it is on for this reader, or a new one."""
    principal = me()
    if request is not None and request.method == "POST":
        with session_scope() as session:
            return service.create_flag(session, json_body(), principal=principal), 201

    args = request.args.to_dict() if request is not None else {}
    with session_scope() as session:
        return service.flags(session, args, principal=principal), 200


@requires("flags.manage")
def flag(app=None, operation: str = "", request=None, key: str = "", **kwargs: Any):
    """Turn a flag on or off, change its rollout, or remove it."""
    principal = me()
    identifier = key or str(kwargs.get("key") or "")
    with session_scope() as session:
        if request is not None and request.method == "DELETE":
            return service.remove_flag(session, identifier, principal=principal), 200
        return service.update_flag(session, identifier, json_body(), principal=principal), 200
