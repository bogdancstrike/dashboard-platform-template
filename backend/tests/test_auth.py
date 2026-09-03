"""JWT verification cache behavior (§58, §76)."""

from __future__ import annotations

import time

from src.core import auth


def _install_verifier(monkeypatch, claims):
    monkeypatch.setattr(auth.jwt, "get_unverified_header", lambda _token: {"kid": "key-1"})
    monkeypatch.setattr(auth._jwks, "get", lambda _kid: {"kid": "key-1", "alg": "RS256"})
    calls = []

    def decode(token, *_args, **_kwargs):
        calls.append(token)
        return dict(claims)

    monkeypatch.setattr(auth.jwt, "decode", decode)
    return calls


def test_verified_claims_are_cached_for_the_tokens_remaining_lifetime(monkeypatch):
    expires_at = int(time.time()) + 300
    decoded = _install_verifier(monkeypatch, {"sub": "user-1", "exp": expires_at})
    stored = {}

    monkeypatch.setattr("src.core.cache.get_json", lambda key: stored.get(key, (None, None))[0])

    def save(key, value, ttl=None):
        stored[key] = (value, ttl)

    monkeypatch.setattr("src.core.cache.set_json", save)

    first = auth.verify_token("header.payload.signature")
    second = auth.verify_token("header.payload.signature")

    assert first == second == {"sub": "user-1", "exp": expires_at}
    assert decoded == ["header.payload.signature"]
    cached_claims, ttl = next(iter(stored.values()))
    assert cached_claims == first
    assert 298 <= ttl <= 300


def test_the_cache_never_stores_the_raw_bearer_token(monkeypatch):
    token = "reusable-secret-bearer-token"
    _install_verifier(monkeypatch, {"sub": "user-1", "exp": int(time.time()) + 60})
    written = []
    monkeypatch.setattr("src.core.cache.get_json", lambda _key: None)
    monkeypatch.setattr(
        "src.core.cache.set_json",
        lambda key, value, ttl=None: written.append((key, value, ttl)),
    )

    auth.verify_token(token)

    key, claims, _ttl = written[0]
    assert token not in key
    assert token not in str(claims)
    assert key.endswith(authlib_digest(token))


def test_an_expired_cache_entry_is_verified_again(monkeypatch):
    decoded = _install_verifier(
        monkeypatch, {"sub": "user-1", "exp": int(time.time()) + 60}
    )
    monkeypatch.setattr(
        "src.core.cache.get_json",
        lambda _key: {"sub": "stale", "exp": int(time.time()) - 1},
    )
    monkeypatch.setattr("src.core.cache.set_json", lambda *_args, **_kwargs: None)

    claims = auth.verify_token("token")

    assert claims["sub"] == "user-1"
    assert decoded == ["token"]


def test_different_tokens_never_share_a_cache_entry(monkeypatch):
    decoded = _install_verifier(
        monkeypatch, {"sub": "user-1", "exp": int(time.time()) + 60}
    )
    seen_keys = []
    monkeypatch.setattr(
        "src.core.cache.get_json", lambda key: seen_keys.append(key) or None
    )
    monkeypatch.setattr("src.core.cache.set_json", lambda *_args, **_kwargs: None)

    auth.verify_token("token-a")
    auth.verify_token("token-b")

    assert len(set(seen_keys)) == 2
    assert decoded == ["token-a", "token-b"]


def authlib_digest(token: str) -> str:
    import hashlib

    return hashlib.sha256(token.encode("utf-8")).hexdigest()
