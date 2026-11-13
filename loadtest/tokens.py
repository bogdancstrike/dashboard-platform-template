"""Persona tokens for the load test — signed in ONCE, shared by every simulated user.

Keycloak's brute-force protection is on in the `template` realm, and a load
test that signs in a thousand times is indistinguishable from an attack on it.
So the run signs each seeded persona in exactly once (OAuth2 direct grant on
the public `template-spa` client, the same one the e2e suite uses), caches the
tokens in `loadtest/.tokens.json` (git-ignored) and hands the same bearer to
every simulated user of that persona. Expiring tokens are renewed with the
*refresh* grant, which is not a password attempt and so never counts towards a
lockout.

    python tokens.py            # sign in (or refresh) and print a summary
    python tokens.py --check    # exit 1 if any cached token expires within 20 min

Never prints a token.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from pathlib import Path

import requests

KEYCLOAK = os.getenv("KEYCLOAK_URL", "http://localhost:8080").rstrip("/")
REALM = os.getenv("KEYCLOAK_REALM", "template")
CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "template-spa")
CACHE = Path(os.getenv("LOADTEST_TOKEN_CACHE", Path(__file__).with_name(".tokens.json")))

#: The seeded personas (username = password in the demo realm).
PERSONAS = ("admin", "manager", "operator", "analyst", "user")

#: Renew when a token has less than this long to live.
MIN_LIFETIME_SECONDS = int(os.getenv("LOADTEST_MIN_TOKEN_SECONDS", "1200"))

_lock = threading.Lock()


def _endpoint() -> str:
    return f"{KEYCLOAK}/realms/{REALM}/protocol/openid-connect/token"


def _stamp(payload: dict) -> dict:
    now = time.time()
    return {
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token", ""),
        "expires_at": now + int(payload.get("expires_in", 300)),
        "refresh_expires_at": now + int(payload.get("refresh_expires_in", 0) or 0),
    }


def _password_grant(persona: str) -> dict:
    response = requests.post(
        _endpoint(),
        data={"client_id": CLIENT_ID, "grant_type": "password", "username": persona, "password": persona},
        timeout=15,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Keycloak refused the direct grant for {persona!r}: HTTP {response.status_code}")
    return _stamp(response.json())


def _refresh_grant(entry: dict) -> dict | None:
    if not entry.get("refresh_token") or entry.get("refresh_expires_at", 0) < time.time() + 30:
        return None
    response = requests.post(
        _endpoint(),
        data={"client_id": CLIENT_ID, "grant_type": "refresh_token", "refresh_token": entry["refresh_token"]},
        timeout=15,
    )
    if response.status_code != 200:
        return None
    return _stamp(response.json())


def _read_cache() -> dict:
    try:
        return json.loads(CACHE.read_text())
    except (OSError, ValueError):
        return {}


def _write_cache(data: dict) -> None:
    tmp = CACHE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data))
    os.chmod(tmp, 0o600)
    tmp.replace(CACHE)


def ensure(personas=PERSONAS, *, min_lifetime: int = MIN_LIFETIME_SECONDS) -> dict[str, dict]:
    """A live token per persona: cached → refreshed → (last resort) one password grant."""
    with _lock:
        data = _read_cache()
        changed = False
        for persona in personas:
            entry = data.get(persona) or {}
            if entry.get("expires_at", 0) > time.time() + min_lifetime:
                continue
            renewed = _refresh_grant(entry) if entry else None
            data[persona] = renewed or _password_grant(persona)
            changed = True
        if changed:
            _write_cache(data)
        return {p: data[p] for p in personas}


def bearer(persona: str) -> str:
    return ensure((persona,), min_lifetime=60)[persona]["access_token"]


def main(argv: list[str]) -> int:
    if "--check" in argv:
        data = _read_cache()
        bad = [p for p in PERSONAS if data.get(p, {}).get("expires_at", 0) < time.time() + MIN_LIFETIME_SECONDS]
        print("stale: " + ", ".join(bad) if bad else "all persona tokens fresh")
        return 1 if bad else 0
    tokens = ensure()
    for persona, entry in tokens.items():
        print(f"{persona:9s} token valid for {int(entry['expires_at'] - time.time())}s")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
