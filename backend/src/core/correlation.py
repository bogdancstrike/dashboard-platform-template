"""Correlation-ID and CORS hooks.

The correlation id doubles as the trace join key: an inbound W3C `traceparent`
is honoured so a click in the UI becomes the root of one trace that reaches all
the way into the backend. Every response carries the id back, and the frontend
prints it on error screens — which is what makes a screenshot of a failure
actionable.
"""

from __future__ import annotations

import uuid

from flask import g, request

CORRELATION_HEADER = "X-Correlation-ID"
TRACEPARENT_HEADER = "traceparent"


def correlation_id() -> str:
    return getattr(g, "correlation_id", "") or ""


def install_flask_hooks(app) -> None:
    allowed = set(app.config.get("ALLOWED_ORIGINS") or [])

    @app.before_request
    def _assign_correlation() -> None:
        incoming = request.headers.get(CORRELATION_HEADER)
        g.correlation_id = incoming or uuid.uuid4().hex
        g.traceparent = request.headers.get(TRACEPARENT_HEADER)

    @app.after_request
    def _apply_headers(response):
        response.headers[CORRELATION_HEADER] = getattr(g, "correlation_id", "")
        origin = request.headers.get("Origin")
        if origin and (origin in allowed or "*" in allowed):
            response.headers["Access-Control-Allow-Origin"] = origin
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
            response.headers["Access-Control-Allow-Headers"] = (
                f"Content-Type, Authorization, {CORRELATION_HEADER}, "
                f"{TRACEPARENT_HEADER}, X-Persona"
            )
            response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            )
            response.headers["Access-Control-Max-Age"] = "600"
        return response

    @app.before_request
    def _short_circuit_preflight():
        if request.method == "OPTIONS":
            return ("", 204)
        return None
