"""Requiring a feature, and the request gate installed on the app."""

from __future__ import annotations

from src.core.feature_catalogue import FEATURES
from src.core.features.endpoints import (
    FeatureDisabledError,
    _endpoint_entries,
    owner_of,
)
from src.core.features.evaluation import globally_enabled, is_enabled


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


#: Flask rule → owning flag, built once at install.
_rule_owner: dict[str, str] = {}


#: Flask rule → whether it is a public (anonymous) endpoint.
_public_rules: dict[str, bool] = {}


def install(app) -> None:
    """Refuse requests to switched-off features, in one place."""
    from flask import g, request

    for entry in _endpoint_entries():
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
