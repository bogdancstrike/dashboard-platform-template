"""Integration endpoints (§26).

One permission, `integrations.manage`: the configuration names hosts and secret
references, which is reconnaissance even where it is not a secret.

No create and no delete. The providers this platform knows how to talk to come
with the code — a list an operator extends by deploying, not by typing a name.
What they can do is configure, enable, and check.

`check` is worth reading the service docstring for: it verifies the
configuration and says in the payload that it did *not* contact the provider.
A button reporting "Connected to Stripe" when no packet left the process would
be the worst possible lie on this screen.
"""

from __future__ import annotations

from typing import Any

from src.core.auth import me, requires
from src.core.db import session_scope
from src.services import integrations as service


@requires("integrations.manage")
def catalogue(app=None, operation: str = "", request=None, **_: Any):
    """Categories and states with a count against each, and what needs attention."""
    with session_scope() as session:
        return service.catalogue(session, principal=me()), 200


@requires("integrations.manage")
def collection(app=None, operation: str = "", request=None, **_: Any):
    """Every integration, filtered and faceted in PostgreSQL."""
    args = request.args if request is not None else {}
    with session_scope() as session:
        return service.listing(session, args, principal=me()), 200


@requires("integrations.manage")
def item(app=None, operation: str = "", request=None, integration_id: str = "", **kwargs: Any):
    """One integration with its configuration — or a change to those settings.

    Values whose *names* say they hold something sensitive come back redacted,
    and sending the redaction back means "leave it alone": a form that had
    never shown the real token would otherwise overwrite it with bullets.
    """
    identifier = integration_id or str(kwargs.get("integration_id") or "")
    method = (request.method if request is not None else "GET").upper()
    with session_scope() as session:
        if method == "PUT":
            payload = (request.get_json(silent=True) if request is not None else None) or {}
            return service.configure(session, identifier, payload, principal=me()), 200
        return service.entry(session, identifier, principal=me()), 200


@requires("integrations.manage")
def enablement(
    app=None, operation: str = "", request=None, integration_id: str = "", **kwargs: Any
):
    """Turn an integration on or off (§26).

    Refused while it is missing settings: switching on something that cannot
    possibly work produces a failure with no cause to find, and the refusal
    names the settings instead.
    """
    identifier = integration_id or str(kwargs.get("integration_id") or "")
    payload = (request.get_json(silent=True) if request is not None else None) or {}
    with session_scope() as session:
        return service.set_enabled(session, identifier, payload, principal=me()), 200


@requires("integrations.manage")
def check(app=None, operation: str = "", request=None, integration_id: str = "", **kwargs: Any):
    """Verify the configuration, and say what was and was not tried (§26).

    Carries `reached_provider: false`, because it is a configuration check and
    not a handshake. See the service docstring for where to make it real.
    """
    identifier = integration_id or str(kwargs.get("integration_id") or "")
    with session_scope() as session:
        return service.check(session, identifier, principal=me()), 200
