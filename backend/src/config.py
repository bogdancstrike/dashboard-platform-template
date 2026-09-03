"""Runtime settings, read once from the environment.

Every value has a working default so `python main.py` starts against a local
Postgres without a `.env` file. Compose overrides what it needs to.
"""

from __future__ import annotations

import os
from urllib.parse import urlsplit as _urlsplit


def _flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, "") or default)
    except ValueError:
        return default


class Config:
    # ── Identity of this process ─────────────────────────────────────────
    SERVICE_NAME = os.getenv("SERVICE_NAME", "platform-api")
    ENVIRONMENT = os.getenv("ENVIRONMENT", "local")
    APP_NAME = os.getenv("APP_NAME", "Nucleus")
    APP_DESCRIPTION = os.getenv("APP_DESCRIPTION", "Enterprise Application Template Platform")
    #: Shown on the health page and in the Swagger document. Set from the build
    #: (a tag or a short SHA) so a running process can be identified.
    APP_VERSION = os.getenv("APP_VERSION", "1.0.0")
    BUILD_REF = os.getenv("BUILD_REF", "dev")

    # ── HTTP ─────────────────────────────────────────────────────────────
    API_PORT = _int("API_PORT", 5101)
    API_PREFIX = os.getenv("API_PREFIX", "/platform")
    SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-change-me")
    ALLOWED_ORIGINS = [
        o.strip()
        for o in os.getenv(
            "ALLOWED_ORIGINS", "http://localhost:5174,http://localhost:3000"
        ).split(",")
        if o.strip()
    ]

    # ── Database ─────────────────────────────────────────────────────────
    DATABASE_URL = os.getenv(
        "DATABASE_URL", "postgresql+psycopg2://platform:platform@localhost:5432/platform"
    )
    DB_POOL_SIZE = _int("DB_POOL_SIZE", 10)
    DB_MAX_OVERFLOW = _int("DB_MAX_OVERFLOW", 20)
    DB_POOL_TIMEOUT = _int("DB_POOL_TIMEOUT", 30)
    DB_ECHO = _flag("DB_ECHO", False)

    # ── Redis (cache; optional — the app degrades to no-cache) ───────────
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    CACHE_ENABLED = _flag("CACHE_ENABLED", True)
    CACHE_TTL_SECONDS = _int("CACHE_TTL_SECONDS", 30)

    # QF's ETL module builds a Redis connection pool at *import* time from
    # these three attributes, and `framework.app.runner` imports it whether or
    # not the ETL is enabled. Deriving them from REDIS_URL keeps one source of
    # truth: setting REDIS_URL alone must never leave QF pointed elsewhere.
    # The pool is lazy, so nothing connects until something asks it to — which
    # in this template is never.
    _redis = _urlsplit(os.getenv("REDIS_URL", "redis://localhost:6379/0"))
    REDIS_HOST = _redis.hostname or "localhost"
    REDIS_PORT = _redis.port or 6379
    REDIS_DB = int((_redis.path or "/0").lstrip("/") or 0)

    # ── Auth — Keycloak (OIDC) ───────────────────────────────────────────
    # Two URLs, not one, and the distinction is the whole reason this works in
    # Docker: keys are FETCHED over the internal network (`keycloak:8080`)
    # while the issuer is VALIDATED against the public address the browser
    # actually used (`localhost:8080`). Collapsing them breaks either the
    # container-to-container fetch or the issuer check.
    KEYCLOAK_INTERNAL_URL = os.getenv("KEYCLOAK_INTERNAL_URL", "http://localhost:8080")
    KEYCLOAK_PUBLIC_URL = os.getenv("KEYCLOAK_PUBLIC_URL", "http://localhost:8080")
    KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "template")
    KEYCLOAK_SPA_CLIENT_ID = os.getenv("KEYCLOAK_SPA_CLIENT_ID", "template-spa")
    KEYCLOAK_AUDIENCE = os.getenv("KEYCLOAK_AUDIENCE", "template-api")
    JWKS_CACHE_TTL = _int("JWKS_CACHE_TTL", 300)
    #: Accept a token whose clock is this far out, for container clock drift.
    JWT_LEEWAY_SECONDS = _int("JWT_LEEWAY_SECONDS", 30)
    #: Create a local profile row the first time a realm user signs in, so
    #: Keycloak stays the identity authority and the platform still owns the
    #: application-side profile (preferences, favourites, org membership).
    AUTO_PROVISION_USERS = _flag("AUTO_PROVISION_USERS", True)

    @classmethod
    def keycloak_issuer(cls) -> str:
        return f"{cls.KEYCLOAK_PUBLIC_URL.rstrip('/')}/realms/{cls.KEYCLOAK_REALM}"

    @classmethod
    def keycloak_jwks_url(cls) -> str:
        return (
            f"{cls.KEYCLOAK_INTERNAL_URL.rstrip('/')}/realms/{cls.KEYCLOAK_REALM}"
            "/protocol/openid-connect/certs"
        )

    # ── Storage (file manager) ───────────────────────────────────────────
    STORAGE_DIR = os.getenv("STORAGE_DIR", "/app/backend/var/storage")
    MAX_UPLOAD_MB = _int("MAX_UPLOAD_MB", 25)

    # ── Seeding ──────────────────────────────────────────────────────────
    SEED_DEMO = _flag("SEED_DEMO", True)
    SEED_SCALE = os.getenv("SEED_SCALE", "full")  # full | small
    SEED_RANDOM_SEED = _int("SEED_RANDOM_SEED", 20260101)

    # ── Observability ────────────────────────────────────────────────────
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    ENABLE_TRACING = _flag("ENABLE_TRACING", False)
    OTLP_ENDPOINT = os.getenv("QSINT_OTLP_ENDPOINT", "")

    # ── QF framework expects these to exist even with the ETL disabled ───
    KAFKA_BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "")
    WORKER_NAME = SERVICE_NAME
    ERROR_TOPIC = os.getenv("ERROR_TOPIC", "platform.dlq")
