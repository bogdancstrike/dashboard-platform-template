"""Token verification against a fake realm: signatures, rotation, refusals (§58, §76).

`core/auth.verify_token` is the front door. Everything else in the platform —
every permission check, every audit row's actor — is downstream of it being
right, and what it had was four tests of its Redis cache: the *cache* was
covered and the verification it caches was not.

The gap that mattered most is **key rotation**. Keycloak rotates its realm
signing keys, tokens signed by the new one arrive with a `kid` the cache has
never seen, and `_JwksCache.get` refreshes once on that miss. If that self-heal
were broken, every signed-in person would be refused until somebody restarted
the API — the kind of outage that looks like Keycloak's fault and is not. It is
also invisible to a test suite that monkeypatches `jwt.decode`, which is why
this file signs real tokens with a real key instead.

So: an RSA keypair generated in the test, published as a JWKS document by a
stubbed `requests.get`, and tokens signed with it. Nothing here talks to
Keycloak, and nothing here trusts the module's own idea of what a valid token
is.
"""

from __future__ import annotations

import base64
import time
from typing import Any

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

from src.config import Config
from src.core import auth
from src.core.errors import UnauthorizedError


def _b64(value: int) -> str:
    """One RSA parameter, base64url as a JWK spells it."""
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


class Realm:
    """A signing key and the JWKS document that publishes it."""

    def __init__(self, kid: str) -> None:
        self.kid = kid
        self._private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        numbers = self._private.public_key().public_numbers()
        self.public_jwk = {
            "kty": "RSA",
            "kid": kid,
            "use": "sig",
            "alg": "RS256",
            "n": _b64(numbers.n),
            "e": _b64(numbers.e),
        }
        private_numbers = self._private.private_numbers()
        self.private_jwk = {
            **self.public_jwk,
            "d": _b64(private_numbers.d),
            "p": _b64(private_numbers.p),
            "q": _b64(private_numbers.q),
            "dp": _b64(private_numbers.dmp1),
            "dq": _b64(private_numbers.dmq1),
            "qi": _b64(private_numbers.iqmp),
        }

    def token(self, **overrides: Any) -> str:
        claims = {
            "sub": "11111111-1111-1111-1111-111111111111",
            "iss": Config.keycloak_issuer(),
            "aud": Config.KEYCLOAK_AUDIENCE,
            "exp": int(time.time()) + 300,
            "iat": int(time.time()),
            "preferred_username": "admin",
            "email": "admin@nucleus.example",
            "realm_access": {"roles": ["administrator"]},
        }
        claims.update(overrides)
        return jwt.encode(claims, self.private_jwk, algorithm="RS256", headers={"kid": self.kid})


@pytest.fixture()
def realm(monkeypatch):
    """A realm whose keys `core/auth` fetches, and a count of the fetches.

    The count is the point of the fixture: "refreshes once on an unknown kid"
    and "does not refresh again for the next token" are the two halves of the
    rotation claim, and neither is observable without it.
    """
    state = {"keys": [], "fetches": 0}

    class Response:
        status_code = 200

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"keys": list(state["keys"])}

    def fetch(url, timeout=None):  # noqa: ARG001 - mirrors requests.get
        assert url == Config.keycloak_jwks_url()
        state["fetches"] += 1
        if state.get("broken"):
            raise RuntimeError("keycloak is unreachable")
        return Response()

    monkeypatch.setattr(auth.requests, "get", fetch)
    # A fresh cache per test: the module-level one carries whatever the last
    # test taught it, and a "rotation" that was really a stale hit would pass.
    monkeypatch.setattr(auth, "_jwks", auth._JwksCache())
    # And no Redis: this file is about the verification, not the cache around
    # it, and a hit would skip the whole path under test.
    monkeypatch.setattr("src.core.cache.get_json", lambda _key: None)
    monkeypatch.setattr("src.core.cache.set_json", lambda *_args, **_kwargs: None)
    return state


def test_a_token_signed_by_the_realm_verifies(realm):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]

    claims = auth.verify_token(key.token())

    assert claims["preferred_username"] == "admin"
    assert claims["iss"] == Config.keycloak_issuer()
    # One fetch, on the first miss.
    assert realm["fetches"] == 1


def test_a_rotated_key_heals_itself_without_a_restart(realm):
    """The claim `_JwksCache` exists to make.

    Keycloak rotates the realm key; the next token carries a `kid` this process
    has never seen. One refresh on that miss is the difference between a
    rotation nobody notices and every signed-in person being refused until the
    API is restarted.
    """
    old = Realm("key-old")
    realm["keys"] = [old.public_jwk]
    assert auth.verify_token(old.token())["sub"]
    assert realm["fetches"] == 1

    # Keycloak rotates: a new key, published, and the old one retired.
    new = Realm("key-new")
    realm["keys"] = [new.public_jwk]

    claims = auth.verify_token(new.token())

    assert claims["preferred_username"] == "admin"
    # Exactly one further fetch — the miss on the unknown `kid`.
    assert realm["fetches"] == 2


def test_a_token_signed_by_a_retired_key_is_refused(realm):
    old = Realm("key-old")
    new = Realm("key-new")
    realm["keys"] = [new.public_jwk]

    with pytest.raises(UnauthorizedError) as raised:
        auth.verify_token(old.token())

    # Refused for the right reason: the key is gone, not the signature wrong.
    assert "unknown key" in str(raised.value).lower()


def test_a_second_token_reuses_the_cached_keys(realm):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]

    auth.verify_token(key.token())
    auth.verify_token(key.token(jti="second"))

    # One fetch for both: a JWKS request per request would put Keycloak on the
    # hot path of every call the platform serves.
    assert realm["fetches"] == 1


def test_the_keys_are_refetched_once_the_cache_goes_stale(realm, monkeypatch):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]
    auth.verify_token(key.token())

    monkeypatch.setattr(Config, "JWKS_CACHE_TTL", 0)
    auth.verify_token(key.token())

    # A rotation that happens while nothing is signing in must still be picked
    # up: the TTL is the other half of the self-heal.
    assert realm["fetches"] == 2


def test_a_signature_from_another_key_is_refused(realm):
    """The whole point of verification: a token the realm did not sign.

    Signed by an impostor whose JWKS advertises the *same* `kid`, which is the
    shape an attacker would send — a token that looks addressed to the right
    key and is not.
    """
    honest = Realm("key-1")
    impostor = Realm("key-1")
    realm["keys"] = [honest.public_jwk]

    with pytest.raises(UnauthorizedError) as raised:
        auth.verify_token(impostor.token())

    assert "verification failed" in str(raised.value).lower()


def test_an_expired_token_says_so_in_words_a_reader_can_act_on(realm):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]

    with pytest.raises(UnauthorizedError) as raised:
        # Beyond the leeway, which exists for container clock drift and not for
        # yesterday.
        auth.verify_token(key.token(exp=int(time.time()) - Config.JWT_LEEWAY_SECONDS - 60))

    # The message the session-expired page shows (§34): what happened and what
    # to do, not "JWTError".
    assert "expired" in str(raised.value).lower()
    assert "sign in again" in str(raised.value).lower()


def test_a_token_inside_the_leeway_is_accepted(realm):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]

    # A few seconds of clock drift between containers must not sign everybody
    # out; that is what the leeway is for.
    claims = auth.verify_token(key.token(exp=int(time.time()) - 5))

    assert claims["sub"]


def test_a_token_for_another_audience_is_refused(realm):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]

    with pytest.raises(UnauthorizedError):
        # A token minted for a different client of the same realm is not a
        # token for this API.
        auth.verify_token(key.token(aud="some-other-client"))


def test_a_token_from_another_issuer_is_refused(realm):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]

    with pytest.raises(UnauthorizedError):
        # A correctly signed token from a realm we do not trust.
        auth.verify_token(key.token(iss="http://evil.example/realms/template"))


def test_a_malformed_or_unsigned_token_is_refused_before_any_fetch(realm):
    for token in ("", "not-a-jwt", "a.b.c"):
        with pytest.raises(UnauthorizedError):
            auth.verify_token(token)
    # And none of them cost a JWKS request: an unauthenticated flood must not
    # become traffic to Keycloak.
    assert realm["fetches"] == 0


def test_a_token_with_no_key_id_is_refused(realm):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]
    token = jwt.encode(
        {"sub": "x", "exp": int(time.time()) + 60},
        key.private_jwk,
        algorithm="RS256",
    )

    with pytest.raises(UnauthorizedError) as raised:
        auth.verify_token(token)

    assert "key id" in str(raised.value).lower()


def test_an_unreachable_keycloak_is_a_401_rather_than_a_500(realm):
    key = Realm("key-1")
    realm["broken"] = True

    with pytest.raises(UnauthorizedError):
        auth.verify_token(key.token())

    # And the readiness probe says so, rather than reporting healthy while
    # nobody can sign in (§24).
    assert auth.auth_health()["status"] == "unavailable"


def test_the_readiness_probe_reports_the_keys_it_actually_holds(realm):
    key = Realm("key-1")
    realm["keys"] = [key.public_jwk]

    health = auth.auth_health()

    assert health["status"] == "healthy"
    assert health["issuer"] == Config.keycloak_issuer()
    assert health["realm"] == Config.KEYCLOAK_REALM


def test_the_role_comes_from_the_realm_roles_not_from_a_claim_anybody_can_set(realm):
    """Membership is Keycloak's; the *meaning* is the platform's (§12, §13).

    A token's `realm_access.roles` is a list Keycloak signed, and the mapping
    to a platform role code lives here — so a claim naming a role the platform
    does not have falls back to the least privilege rather than inventing one.
    """
    assert auth.role_from_claims({"realm_access": {"roles": ["administrator"]}}) == "ADMINISTRATOR"
    assert auth.role_from_claims({"realm_access": {"roles": ["manager"]}}) == "MANAGER"
    # An unmapped role, and no roles at all, both land on the viewer.
    assert auth.role_from_claims({"realm_access": {"roles": ["sysadmin-of-everything"]}}) == "VIEWER"
    assert auth.role_from_claims({}) == "VIEWER"


def test_the_highest_role_wins_when_a_person_holds_several(realm):
    # Keycloak lets a user hold both; the platform has to pick one, and picking
    # the *lower* would make a role assignment silently ineffective.
    assert (
        auth.role_from_claims({"realm_access": {"roles": ["viewer", "manager", "operator"]}})
        == "MANAGER"
    )
