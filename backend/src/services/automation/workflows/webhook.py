"""The webhook action: one POST to an allowed URL, never following a redirect."""

from __future__ import annotations

import json
import urllib.request
from typing import Any
from urllib.parse import urlparse

from src.core.clock import iso, now
from src.core.errors import ValidationError
from src.models.platform import AlertRule
from src.services.automation.workflows.actions import WEBHOOK_TIMEOUT_SECONDS, Match


def _webhook(session, *, rule: AlertRule, match: Match, config: dict[str, Any], **_: Any) -> str:
    """POST the match to an address somebody configured.

    Bounded on purpose: http(s) only, one attempt, no redirects followed, and a
    short timeout — this runs inside the request until §23 gives it a worker.
    The URL is validated when the rule is *saved* as well, so a rule cannot sit
    in the table carrying a target the engine will refuse.
    """
    from src.core import features

    if not features.job_allowed("automation.webhook-action"):
        # Recorded as the action's outcome, so the run says why nothing was sent.
        return "skipped: webhooks are switched off"
    url = _webhook_url(config.get("url"))
    payload = json.dumps(
        {
            "rule": {"id": str(rule.id), "name": rule.name, "severity": rule.severity},
            "resource_type": rule.resource_type,
            "record": {"id": match.id, "label": match.label, "path": match.path},
            "at": iso(now()),
        }
    ).encode()
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "Nucleus-Automation/1"},
    )
    opener = urllib.request.build_opener(_NoRedirect())
    with opener.open(request, timeout=WEBHOOK_TIMEOUT_SECONDS) as response:
        return f"POST {response.status}"


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A webhook target that answers with a redirect is not the target."""

    def redirect_request(self, *_args: Any, **_kwargs: Any):  # noqa: D102
        return None


def _webhook_url(raw: Any) -> str:
    """An http(s) address with a host, refused at save time if it is not.

    Checked here and read by the action, so a target the engine will not call
    cannot be stored by the editor.
    """
    url = str(raw or "").strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValidationError(
            "A webhook needs a full http:// or https:// address.", details={"url": url}
        )
    if len(url) > 500:
        raise ValidationError("That webhook address is too long.")
    return url
