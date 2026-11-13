"""Feature flags, enforced (§27).

The catalogue (`core/feature_catalogue.py`) says what each flag controls; this
module makes the API, the background jobs and the live channel obey it.

**One place in the request pipeline.** `install(app)` adds a `before_request`
hook. At boot every endpoint in `maps/endpoint.json` is resolved to the flag
that owns it (most specific pattern wins), keyed by the Flask rule QF mounts
it at. A request to an owned endpoint is evaluated for *its caller*; when the
flag is off it is refused before the handler runs:

    404  {"error": "feature_disabled", "feature": "<key>", "message": ...}

**Why 404 and not 403.** A 403 says "this exists and you may not" — the
frontend answers it with "ask an administrator for a role", which is a lie
when the feature itself is off, and a switched-off feature should not even
confirm that its surface exists. 404 is what the endpoint is, for this reader:
not there. The `error` code is what clients branch on; the status is only
what proxies and generic clients see.

**Per caller.** Rollout percentage and targeting (people, roles, groups,
organizations) are evaluated against the principal, with the same function the
flags screen and `/api/me` use (`services.settings.is_on`). A request with no
principal — a public form, a public dashboard, a webhook — and a background job
are evaluated *globally*: the flag must be switched on. Targeting narrows who
has a feature; it cannot be satisfied by nobody.

**Cached briefly, invalidated on change.** The flag rows are read once per
*generation* (a Redis counter bumped by every flag write — `cache.bump`) and
held in-process for at most `LOCAL_TTL` seconds, so a toggle reaches every
worker on its next request, and a Redis outage costs at most `LOCAL_TTL` of
staleness rather than a database read per call.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

from src.core.errors import ApiError
from src.core.feature_catalogue import CORE_ENDPOINTS, FEATURES, FEATURES_BY_KEY

#: The cache dataset a flag write bumps.
DATASET = "feature_flags"
#: Longest an in-process snapshot is trusted without re-reading the generation.
LOCAL_TTL = 5.0


class FeatureDisabledError(ApiError):
    code = "feature_disabled"
    status_code = 404

    def __init__(self, feature: str):
        name = FEATURES_BY_KEY[feature].name if feature in FEATURES_BY_KEY else feature
        super().__init__(f"{name} is switched off.", details={"feature": feature})
        self.feature = feature

    def to_dict(self) -> dict[str, Any]:
        return {"error": self.code, "feature": self.feature, "message": self.message}


# ── Endpoint ownership ───────────────────────────────────────────────────


def _score(pattern: str, url: str) -> int | None:
    """How specifically `pattern` claims `url`, or None when it does not."""
    if pattern.endswith("*"):
        prefix = pattern[:-1]
        return len(prefix) if url.startswith(prefix) else None
    return 10_000 + len(pattern) if url == pattern else None


def owner_of(url: str) -> tuple[str | None, bool]:
    """(flag key, decided) for an `api_url`. `decided` is False when neither a
    flag nor the core list claims it — which the endpoint-map test refuses."""
    best: tuple[int, str | None] | None = None
    for feature in FEATURES:
        for pattern in feature.endpoints:
            score = _score(pattern, url)
            if score is not None and (best is None or score > best[0]):
                best = (score, feature.key)
    for pattern in CORE_ENDPOINTS:
        score = _score(pattern, url)
        if score is not None and (best is None or score > best[0]):
            best = (score, None)
    if best is None:
        return None, False
    return best[1], True


def endpoint_owners() -> dict[str, str | None]:
    """`api_url` → owning flag (None for core) for every endpoint in the map."""
    from src.api import endpoint_map

    return {
        entry["api_url"]: owner_of(entry["api_url"])[0]
        for entry in endpoint_map.load()["endpoints"]
    }


def endpoints_of(key: str) -> list[dict[str, Any]]:
    """The endpoints one flag owns, as `METHOD /url` rows for the admin screen."""
    from src.api import endpoint_map

    return [
        {"methods": [m.upper() for m in entry["request_method"]], "url": entry["api_url"]}
        for entry in endpoint_map.load()["endpoints"]
        if owner_of(entry["api_url"])[0] == key
    ]


# ── The snapshot ─────────────────────────────────────────────────────────


@dataclass(frozen=True)
class FlagState:
    key: str
    enabled: bool
    rollout_percentage: int
    target_user_ids: tuple[str, ...]
    target_roles: tuple[str, ...]
    target_group_ids: tuple[str, ...]
    target_organization_ids: tuple[str, ...]


_lock = threading.Lock()
_snapshot: dict[str, FlagState] | None = None
_snapshot_generation: int | None = None
_snapshot_at = 0.0


def _read_rows() -> dict[str, FlagState]:
    from sqlalchemy import select

    from src.core.db import session_scope
    from src.models.platform import FeatureFlag

    with session_scope() as session:
        rows = session.scalars(select(FeatureFlag)).all()
        return {
            row.key: FlagState(
                key=row.key,
                enabled=bool(row.enabled),
                rollout_percentage=int(row.rollout_percentage or 0),
                target_user_ids=tuple(row.target_user_ids or ()),
                target_roles=tuple(row.target_roles or ()),
                target_group_ids=tuple(row.target_group_ids or ()),
                target_organization_ids=tuple(getattr(row, "target_organization_ids", None) or ()),
            )
            for row in rows
        }


def snapshot() -> dict[str, FlagState]:
    """Every flag's state, from the in-process cache when it is still current."""
    global _snapshot, _snapshot_generation, _snapshot_at
    from src.core import cache

    generation = cache.generations(DATASET)[DATASET]
    if (
        _snapshot is not None
        and generation == _snapshot_generation
        and time.monotonic() - _snapshot_at < LOCAL_TTL
    ):
        return _snapshot
    with _lock:
        rows = _read_rows()
        _snapshot, _snapshot_generation, _snapshot_at = rows, generation, time.monotonic()
        return rows


def invalidate() -> None:
    """A flag changed: every worker re-reads on its next request."""
    global _snapshot
    from src.core import cache

    _snapshot = None
    cache.bump(DATASET)


# ── Evaluation ───────────────────────────────────────────────────────────


def _group_ids(user_id) -> tuple[str, ...]:
    """The ids *and* names of a person's groups, for group targeting."""
    from sqlalchemy import text

    from src.core.db import session_scope

    try:
        with session_scope() as session:
            rows = session.execute(
                text(
                    "SELECT g.id::text, g.name FROM groups g JOIN user_groups ug ON ug.group_id = g.id "
                    "WHERE ug.user_id = :uid"
                ),
                {"uid": str(user_id)},
            ).all()
    except Exception:  # pragma: no cover - a missing table must not break evaluation
        return ()
    return tuple(value for row in rows for value in row)


def state_on(
    state: FlagState | None,
    *,
    user_id=None,
    role_code: str | None = None,
    groups: tuple[str, ...] = (),
    organization_id=None,
) -> bool:
    """The rollout rule for one flag and one reader — see `services.settings.is_on`."""
    from src.services.settings import evaluate

    if state is None:
        # A key the platform has no row for gates nothing.
        return True
    return evaluate(
        enabled=state.enabled,
        key=state.key,
        rollout=state.rollout_percentage,
        user_ids=state.target_user_ids,
        roles=state.target_roles,
        group_ids=state.target_group_ids,
        organization_ids=state.target_organization_ids,
        user_id=user_id,
        role_code=role_code,
        groups=groups,
        organization_id=organization_id,
    )


def _principal_context(principal) -> dict[str, Any]:
    if principal is None:
        return {}
    groups = tuple(getattr(principal, "groups", ()) or ())
    return {
        "user_id": principal.user_id,
        "role_code": principal.role_code,
        "groups": groups,
        "organization_id": principal.organization_id,
    }


def enabled_map(principal, states: dict[str, FlagState] | None = None) -> dict[str, bool]:
    """Every flag the platform has, and whether it is on for `principal`.

    Parents count: a child whose parent is off is off. Group targets are only
    looked up when some flag targets a group, which is rare.
    """
    states = snapshot() if states is None else states
    context = _principal_context(principal)
    if principal is not None and any(state.target_group_ids for state in states.values()):
        context["groups"] = tuple(context.get("groups", ())) + _group_ids(principal.user_id)
    own = {
        key: (state.enabled if principal is None else state_on(state, **context))
        for key, state in states.items()
    }

    def resolved(key: str, seen: frozenset[str] = frozenset()) -> bool:
        if not own.get(key, True):
            return False
        feature = FEATURES_BY_KEY.get(key)
        if feature is None:
            return own.get(key, True)
        return all(resolved(parent, seen | {key}) for parent in feature.requires if parent not in seen)

    return {key: resolved(key) for key in sorted(own)}


def is_enabled(key: str, principal=None) -> bool:
    """Whether one feature is on for `principal` (or globally, with None)."""
    states = snapshot()
    if key not in states and key not in FEATURES_BY_KEY:
        return True
    return enabled_map(principal, states).get(key, True)


def globally_enabled(key: str) -> bool:
    """For background work and anonymous callers: is the switch on at all?"""
    return is_enabled(key, None)


def require(key: str, principal=None) -> None:
    """Raise `feature_disabled` unless `key` is on for `principal`."""
    if not is_enabled(key, principal):
        raise FeatureDisabledError(key)


def job_allowed(code: str) -> bool:
    """Whether a background job may run: its owning flag is switched on."""
    for feature in FEATURES:
        if code in feature.jobs:
            return globally_enabled(feature.key)
    return True


def live_allowed(message_type: str | None, flags: dict[str, bool]) -> bool:
    """Whether a live-channel message may be delivered to a reader with `flags`."""
    if not flags.get("live-updates", True):
        return False
    for feature in FEATURES:
        if message_type and message_type in feature.live and not flags.get(feature.key, True):
            return False
    return True


# ── The request hook ─────────────────────────────────────────────────────

#: Flask rule → owning flag, built once at install.
_rule_owner: dict[str, str] = {}
#: Flask rule → whether it is a public (anonymous) endpoint.
_public_rules: dict[str, bool] = {}


def install(app) -> None:
    """Refuse requests to switched-off features, in one place."""
    from flask import g, request

    from src.api import endpoint_map

    for entry in endpoint_map.load()["endpoints"]:
        key = owner_of(entry["api_url"])[0]
        if key:
            rule = f"/{entry['namespace']}{entry['api_url']}"
            _rule_owner[rule] = key
            _public_rules[rule] = entry["api_url"].startswith("/public/")

    @app.before_request
    def _feature_gate():
        if request.method == "OPTIONS":
            return None
        if request.headers.get("X-Impersonate-User") and not globally_enabled("impersonation"):
            return _refusal("impersonation")
        rule = request.url_rule.rule if request.url_rule is not None else ""
        key = _rule_owner.get(rule)
        if key is None:
            return None
        principal = _caller()
        if principal is None and not _public_rules.get(rule, False):
            # Who before what: an anonymous call to an authenticated endpoint
            # gets the handler's 401, so a switched-off feature never answers
            # "this exists, and it is off" to somebody who has not signed in.
            return None
        if not is_enabled(key, principal):
            g.feature_refused = key
            return _refusal(key)
        return None


def _refusal(key: str):
    """The refusal as a response, not a raise: Flask-RESTX decorates a raised
    404 with "did you mean …" route suggestions, which would both pollute the
    envelope and advertise the very routes that are switched off."""
    from flask import jsonify

    response = jsonify(FeatureDisabledError(key).to_dict())
    response.status_code = FeatureDisabledError.status_code
    return response


def _caller():
    """The principal, or None for an anonymous / not-yet-valid caller.

    A bad token is not this hook's business: the endpoint's own guard answers
    it with the proper 401, so it is treated here as anonymous.
    """
    from src.core.auth import principal_from_request

    try:
        return principal_from_request(required=False)
    except Exception:
        return None


# ── The live channel ─────────────────────────────────────────────────────


class GatedSocket:
    """A live socket that only carries what its reader's features allow.

    `live.subscribe` is handed this instead of the raw socket, so *every*
    publish — chat, typing, presence, notifications — passes one check, and a
    flag switched off mid-connection takes effect on the next message rather
    than on the next reconnect. When `live-updates` itself goes off, the socket
    is closed; the client reconnects, is refused, and falls back to polling.
    """

    def __init__(self, socket, principal):
        self.socket = socket
        self.principal = principal

    def send(self, message: str) -> None:
        import json

        try:
            kind = json.loads(message).get("type")
        except (TypeError, ValueError, AttributeError):
            kind = None
        if kind == "features.changed":
            # Always delivered: it is what tells the client to refetch.
            self.socket.send(message)
            flags = enabled_map(self.principal)
            if not flags.get("live-updates", True):
                self.socket.close()
            return
        flags = enabled_map(self.principal)
        if not flags.get("live-updates", True):
            self.socket.close()
            return
        if live_allowed(kind, flags):
            self.socket.send(message)

    def accepts_frame(self, raw: str) -> bool:
        """Whether a frame the browser sent may be handled (presence is chat's)."""
        return raw == "pong" or is_enabled("chat", self.principal)
