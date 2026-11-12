"""Keycloak's JWKS endpoint unreachable or hung: signed-in people stay signed in.

Tokens are verified against the realm's public keys, fetched from Keycloak and
cached (`core/auth._JwksCache`, `JWKS_CACHE_TTL`). What an outage used to do:

* once the cache went stale, **every** request tried to re-fetch — under the
  cache's lock, so with Keycloak hung each request waited its 5 s turn and the
  API serialised behind a dependency it did not need;
* and a failed refresh threw the *stale but valid* keys away in effect, since
  `get` only returned keys from a fresh cache.

Now a failed fetch backs off (`RETRY_SECONDS`) and the last keys keep
verifying until a fetch succeeds.
"""

from __future__ import annotations

import time

import pytest
import requests

from src.config import Config
from src.core import auth
from src.core.errors import UnauthorizedError
from tests.chaos.conftest import Stopwatch
from tests.test_jwks import Realm


@pytest.fixture()
def keycloak(monkeypatch):
    """The JWKS endpoint, with a switch: up, refused, or hung."""
    state = {"keys": [], "fetches": 0, "mode": "up"}

    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {"keys": list(state["keys"])}

    def fetch(url, timeout=None):  # noqa: ARG001
        state["fetches"] += 1
        if state["mode"] == "refused":
            raise requests.ConnectionError("Connection refused")
        if state["mode"] == "hung":
            time.sleep(0.2)  # stands in for the 5 s read timeout
            raise requests.Timeout("Read timed out")
        return Response()

    monkeypatch.setattr(auth.requests, "get", fetch)
    monkeypatch.setattr(auth, "_jwks", auth._JwksCache())
    monkeypatch.setattr("src.core.cache.get_json", lambda _key: None)
    monkeypatch.setattr("src.core.cache.set_json", lambda *_a, **_k: None)
    return state


def _make_stale():
    auth._jwks._fetched_at = time.time() - Config.JWKS_CACHE_TTL - 1


@pytest.mark.parametrize("mode", ["refused", "hung"])
def test_cached_keys_keep_verifying_while_keycloak_is_down(keycloak, mode):
    key = Realm("chaos-key")
    keycloak["keys"] = [key.public_jwk]
    auth.verify_token(key.token())
    assert keycloak["fetches"] == 1

    keycloak["mode"] = mode
    _make_stale()
    with Stopwatch() as watch:
        for _ in range(25):
            assert auth.verify_token(key.token())["preferred_username"] == "admin"
    assert keycloak["fetches"] == 2, "one retry, then back off — not a fetch per request"
    assert watch.seconds < 2


def test_keycloak_is_tried_again_after_the_back_off(keycloak, monkeypatch):
    key = Realm("chaos-key")
    keycloak["keys"] = [key.public_jwk]
    auth.verify_token(key.token())
    keycloak["mode"] = "refused"
    _make_stale()
    auth.verify_token(key.token())
    fetches = keycloak["fetches"]

    keycloak["mode"] = "up"
    auth._jwks._failed_at = time.time() - auth._JwksCache.RETRY_SECONDS - 1
    auth.verify_token(key.token())
    assert keycloak["fetches"] == fetches + 1
    assert not auth._jwks._stale()


def test_an_unknown_key_while_keycloak_is_down_is_a_401_not_a_500(keycloak):
    known, rotated = Realm("old"), Realm("new")
    keycloak["keys"] = [known.public_jwk]
    auth.verify_token(known.token())
    keycloak["mode"] = "refused"
    with pytest.raises(UnauthorizedError):
        auth.verify_token(rotated.token())


def test_an_api_request_with_keycloak_down_and_no_cached_keys_is_a_401(client, keycloak):
    keycloak["mode"] = "refused"
    response = client.get(f"{Config.API_PREFIX}/api/me", headers={"Authorization": f"Bearer {Realm('x').token()}"})
    assert response.status_code == 401
    assert response.get_json()["error"] == "unauthorized"


def test_health_reports_keycloak_down_without_failing(client, keycloak):
    keycloak["mode"] = "refused"
    assert auth.auth_health()["status"] != "healthy"
    assert client.get(f"{Config.API_PREFIX}/health/live").status_code == 200
