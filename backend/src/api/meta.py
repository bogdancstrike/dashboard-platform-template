"""Metadata the frontend reads before it knows anything else.

`/meta/app` is unauthenticated on purpose: it carries the OIDC coordinates the
SPA needs to *start* a login, which it cannot have obtained by logging in. That
is public information by construction — a realm URL, a realm name and a public
client id are all visible in the browser's network tab of any OIDC app. No
secret is served here, and none may ever be added.
"""

from __future__ import annotations

from typing import Any

from src.config import Config
from src.core.auth import (
    ALL_PERMISSIONS,
    PERMISSION_GROUPS,
    PERMISSION_LABELS,
    ROLE_DEFAULTS,
)
from src.core.clock import iso, now


def application(app=None, operation: str = "", request=None, **_: Any):
    """Branding, environment and the OIDC configuration for the SPA adapter."""
    return {
        "name": Config.APP_NAME,
        "description": Config.APP_DESCRIPTION,
        "version": Config.APP_VERSION,
        "build": Config.BUILD_REF,
        "environment": Config.ENVIRONMENT,
        "api_prefix": Config.API_PREFIX,
        "server_time": iso(now()),
        "auth": {
            # The *public* URL, because this is what a browser will be
            # redirected to. The internal URL never leaves the backend.
            "issuer": Config.keycloak_issuer(),
            "url": Config.KEYCLOAK_PUBLIC_URL,
            "realm": Config.KEYCLOAK_REALM,
            "client_id": Config.KEYCLOAK_SPA_CLIENT_ID,
            "audience": Config.KEYCLOAK_AUDIENCE,
        },
        "features": {
            "cache": Config.CACHE_ENABLED,
            "tracing": Config.ENABLE_TRACING,
            "auto_provision_users": Config.AUTO_PROVISION_USERS,
        },
        "limits": {"max_upload_mb": Config.MAX_UPLOAD_MB},
    }, 200


def permissions(app=None, operation: str = "", request=None, **_: Any):
    """The catalogue, in the grouping the admin permission matrix renders."""
    return {
        "groups": [
            {
                "name": group,
                "permissions": [
                    {"code": code, "label": label} for code, label in entries
                ],
            }
            for group, entries in PERMISSION_GROUPS.items()
        ],
        "total": len(ALL_PERMISSIONS),
    }, 200


def roles(app=None, operation: str = "", request=None, **_: Any):
    """Built-in role definitions.

    These are the *defaults* the seed writes into the `roles` table, not the
    live values — an administrator who edits a role changes the table, and the
    admin screens read that. Served here so a fresh frontend can render the
    matrix before any data exists.
    """
    return {
        "items": [
            {
                "code": code,
                "name": definition["name"],
                "description": definition["description"],
                "rank": definition["rank"],
                "color": definition["color"],
                "permissions": definition["permissions"],
                "permission_labels": [
                    PERMISSION_LABELS.get(p, p) for p in definition["permissions"]
                ],
            }
            for code, definition in sorted(
                ROLE_DEFAULTS.items(), key=lambda kv: -kv[1]["rank"]
            )
        ],
        "total": len(ROLE_DEFAULTS),
    }, 200


def routes(app=None, operation: str = "", request=None, **_: Any):
    """Every route this process serves, from the same table it was mounted from."""
    from src.api.routes import NAMESPACES, ROUTES

    return {
        "prefix": Config.API_PREFIX,
        "namespaces": [
            {"name": name, "description": description}
            for name, description in NAMESPACES.items()
        ],
        "items": [
            {
                "operation": route.operation,
                "namespace": route.namespace,
                "url": f"{Config.API_PREFIX}{route.url}",
                "methods": list(route.methods),
                "summary": route.summary,
                "handler": route.handler,
            }
            for route in ROUTES
        ],
        "total": len(ROUTES),
    }, 200
