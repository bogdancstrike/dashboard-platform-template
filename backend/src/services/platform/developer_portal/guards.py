"""Who may call a handler, the changelog, and Flask-RESTX's swagger document."""

from __future__ import annotations

import importlib
import inspect
import re
from typing import Any

USAGE_PERMISSION = "api.manage"


#: How much of a captured response is kept: lists to this many items, strings
#: to this many characters, nesting to this depth.
SAMPLE_ITEMS = 3


SAMPLE_CHARS = 240


SAMPLE_DEPTH = 6


_PARAM = re.compile(r"<(?:(?P<kind>[a-z]+):)?(?P<name>[a-z_]+)>")


#: Shown above the reference; dates are the releases' own.
CHANGELOG: list[dict[str, Any]] = [
    {"version": "1.9", "date": "2026-11-13", "title": "Workflows as graphs",
     "items": ["`/api/automations/rules/<id>/graph` — draft, publish, versions, test runs",
               "Webhook triggers at `/platform/public/automations/hooks/<token>`",
               "API keys authenticate with the `X-Api-Key` header"]},
    {"version": "1.8", "date": "2026-11-12", "title": "Time, decisions and collaboration",
     "items": ["Approvals inbox, SLA policies, intake forms and time tracking endpoints",
               "Team chat, record threads and the wiki under `/api/chat` and `/api/docs`"]},
    {"version": "1.7", "date": "2026-11-12", "title": "Work planning and the assistant",
     "items": ["Sprints, epics, dependencies and the timeline under `/api/work`",
               "The AI assistant, daily brief and document Q&A under `/api/assistant` and `/api/knowledge`"]},
    {"version": "1.6", "date": "2026-09-10", "title": "Report documents",
     "items": ["Composed report documents with blocks under `/api/report-documents`"]},
]


def _guard(module_name: str, method_name: str) -> dict[str, Any]:
    """Who may call a handler, read off its decorators, and its docstring."""
    try:
        module = importlib.import_module(module_name)
        handler = getattr(module, method_name)
    except (ImportError, AttributeError):
        return {"access": "unknown", "permissions": [], "doc": ""}
    permissions = list(getattr(handler, "__platform_permissions__", ()) or ())
    doc = inspect.getdoc(handler) or ""
    access = "permission" if permissions else "authenticated"
    try:
        source = inspect.getsource(module)
        match = re.search(rf"((?:^@[^\n]*\n)+)def {re.escape(method_name)}\(", source, re.M)
        decorators = match.group(1) if match else ""
    except (OSError, TypeError):
        decorators = ""
    if not permissions:
        if "@optional" in decorators:
            access = "public"
        elif "@authenticated" not in decorators and "@requires" not in decorators:
            access = "public"
    return {"access": access, "permissions": permissions, "doc": doc}


def _group(url: str) -> str:
    parts = [part for part in url.split("/") if part]
    if not parts:
        return "platform"
    if parts[0] in ("api", "public") and len(parts) > 1:
        return parts[1] if parts[0] == "api" else f"public-{parts[1]}"
    return parts[0]


def _swagger() -> dict[str, Any]:
    """Flask-RESTX's own document, fetched once per process."""
    cached = _SWAGGER.get("doc")
    if cached is not None:
        return cached
    document: dict[str, Any] = {}
    try:
        from flask import current_app

        with current_app.test_client() as client:
            response = client.get("/swagger.json")
            if response.status_code == 200:
                document = response.get_json() or {}
    except Exception:  # noqa: BLE001 - the reference stands without it
        document = {}
    _SWAGGER["doc"] = document
    return document


_SWAGGER: dict[str, Any] = {}


def _swagger_path(url: str, prefix: str) -> str:
    return prefix + _PARAM.sub(lambda m: "{" + m.group("name") + "}", url)
