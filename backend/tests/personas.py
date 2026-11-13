"""Signing in as the five seeded personas, for tests (not a test module).

Two ways, both through the real users/roles rows:

* `sign_in(monkeypatch, "analyst")` — request headers; `verify_token` is
  patched to return that persona's claims, so the principal is built by
  `core/auth` exactly as for a browser.
* `principal(app, "analyst")` — the same principal, for calling a service
  function directly.
"""

from __future__ import annotations

from src.config import Config
from tests.conftest import persona_claims

PREFIX = Config.API_PREFIX

#: Persona → realm role, as the realm assigns them.
ROLES = {
    "admin": "administrator",
    "manager": "manager",
    "operator": "operator",
    "analyst": "analyst",
    "user": "user",
}


def sign_in(monkeypatch, persona: str = "admin") -> dict[str, str]:
    """Headers that authenticate as `persona` for every request after this call."""
    claims = persona_claims(persona, ROLES[persona], sid=f"cov-{persona}")
    monkeypatch.setattr("src.core.auth.verify_token", lambda _token: claims)
    return {"Authorization": f"Bearer cov-{persona}"}


def as_each(monkeypatch):
    """`headers = as_each(monkeypatch); headers("user")` — switch persona per request."""
    current: dict[str, dict] = {}

    def verify(token: str) -> dict:
        persona = token.removeprefix("cov-")
        return current.setdefault(persona, persona_claims(persona, ROLES[persona], sid=f"cov-{persona}"))

    monkeypatch.setattr("src.core.auth.verify_token", verify)
    return lambda persona: {"Authorization": f"Bearer cov-{persona}"}


def principal(app, persona: str = "admin"):
    from src.core.auth import _principal_from_claims

    with app.test_request_context("/"):
        return _principal_from_claims(persona_claims(persona, ROLES[persona], sid=f"cov-{persona}"))
