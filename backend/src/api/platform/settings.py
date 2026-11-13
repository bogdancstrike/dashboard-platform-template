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

from src.api.handler import Call, endpoint
from src.core.auth import me, requires
from src.core.db import session_scope
from src.services.platform import settings as service


@requires("settings.manage")
@endpoint
def collection(call: Call):
    """Every setting, grouped, with what the platform ships with beside it."""
    principal = me()
    args = call.args
    with session_scope() as session:
        return service.settings(session, args, principal=principal), 200


@requires("settings.manage")
@endpoint
def item(call: Call, key: str = ""):
    """Change one setting, or reset it to its default."""
    principal = me()
    identifier = key
    with session_scope() as session:
        return service.update_setting(session, identifier, call.body, principal=principal), 200


@requires("flags.manage")
@endpoint
def flags(call: Call):
    """Every flag and whether it is on for this reader, or a new one."""
    principal = me()
    if call.method == "POST":
        with session_scope() as session:
            answer = service.create_flag(session, call.body, principal=principal)
        _flags_changed([answer["key"]])
        return answer, 201

    args = call.args
    with session_scope() as session:
        return service.flags(session, args, principal=principal), 200


@requires("flags.manage")
@endpoint
def flag(call: Call, key: str = ""):
    """Turn a flag on or off, change its rollout, or remove it."""
    principal = me()
    identifier = key
    with session_scope() as session:
        if call.method == "DELETE":
            answer = service.remove_flag(session, identifier, principal=principal)
        else:
            answer = service.update_flag(session, identifier, call.body, principal=principal)
    # After the commit, never inside it: a worker that re-read the flags
    # between the bump and the commit would cache the old state under the
    # new generation.
    _flags_changed([identifier])
    return answer, 200


@requires("flags.manage")
@endpoint
def flag_history(call: Call, key: str = ""):
    """Every recorded change to one flag."""
    identifier = key
    args = call.args
    with session_scope() as session:
        return service.flag_history(session, identifier, args, principal=me()), 200


@requires("flags.manage")
@endpoint
def flag_preview(call: Call):
    """What a role, person, group or organization would see."""
    args = call.args
    with session_scope() as session:
        return service.preview(session, args, principal=me()), 200


def _flags_changed(keys: list[str]) -> None:
    """Invalidate every worker's flag cache and tell every open client.

    The live message carries no state — each client refetches its own
    `/api/me`, because what a flag means *for a reader* is computed per
    reader. Clients without the live channel pick it up on their poll.
    """
    from src.core import features
    from src.services.collaboration import live

    features.invalidate()
    try:
        live.publish_to_all({"type": "features.changed", "keys": keys})
    except Exception:  # pragma: no cover - delivery is best-effort
        pass
