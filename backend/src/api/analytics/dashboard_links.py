"""Public and embeddable dashboard links (§25).

The three `public_*` handlers are the only endpoints of this feature an
anonymous caller reaches; the token in the path is the credential, a password
is exchanged for a signed grant, and every one is rate-limited per address.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import json_body, me, requires
from src.core.db import session_scope
from src.services.analytics import dashboard_links as service


def _method(request, default: str = "GET") -> str:
    return (request.method if request is not None else default).upper()


def _client() -> str:
    from flask import request as flask_request

    forwarded = (flask_request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    return forwarded or flask_request.remote_addr or "unknown"


@requires("dashboards.manage")
def links(app=None, operation: str = "", request=None, **kwargs: Any):
    """A dashboard's public links (GET), or a new one (POST, `dashboards.publish`)."""
    with session_scope() as session:
        if _method(request) == "POST":
            return service.create(session, kwargs.get("dashboard_id"), json_body(), principal=me()), 201
        return service.links(session, kwargs.get("dashboard_id"), principal=me()), 200


@requires("dashboards.manage")
def link(app=None, operation: str = "", request=None, **kwargs: Any):
    """Change (PUT) or revoke (DELETE) one public link."""
    with session_scope() as session:
        if _method(request) == "DELETE":
            return service.revoke(session, kwargs.get("dashboard_id"), kwargs.get("link_id"), principal=me()), 200
        return service.update(session, kwargs.get("dashboard_id"), kwargs.get("link_id"), json_body(),
                              principal=me()), 200


def public_meta(app=None, operation: str = "", request=None, **kwargs: Any):
    """Whether a link needs a password, before any data is asked for."""
    with session_scope() as session:
        return service.meta(session, str(kwargs.get("token") or ""), client=_client()), 200


def public_view(app=None, operation: str = "", request=None, **kwargs: Any):
    """The dashboard, read-only, every widget answered on the server."""
    from flask import request as flask_request

    grant = flask_request.headers.get("X-Share-Grant") or None
    embed = flask_request.args.get("embed_origin")
    with session_scope() as session:
        return service.view(session, str(kwargs.get("token") or ""), grant=grant, client=_client(),
                            embed_origin=embed if embed is not None else None), 200


def public_unlock(app=None, operation: str = "", request=None, **kwargs: Any):
    """Exchange the link's password for a short-lived grant."""
    with session_scope() as session:
        return service.unlock(session, str(kwargs.get("token") or ""), json_body(), client=_client()), 200
