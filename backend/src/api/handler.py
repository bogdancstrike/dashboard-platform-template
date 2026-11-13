"""The handler adapter: QF's calling convention in, one `Call` object out.

QF's dynamic router calls every handler as
`fn(app=..., operation=..., request=..., **path_params)`. Three hundred
handlers used to repeat that signature, re-read path parameters from
`**kwargs`, guard `request is not None`, and open a session to call one
service with the caller. `@endpoint` keeps QF's contract on the outside and
hands the function a `Call` plus its path parameters by name:

    @requires("records.view")
    @endpoint
    def item(call: Call, tag_id: str = ""):
        if call.method == "PUT":
            return call.run(service.update, tag_id, call.body), 200
        return call.run(service.remove, tag_id), 200

Everything on `Call` is lazy, so the guards above it still run first and a
`GET` never parses a body. Put `@endpoint` *below* the guard: the developer
portal reads the guard decorator straight above `def`.
"""

from __future__ import annotations

import functools
from functools import cached_property
from typing import Any, Callable

from src.core.auth import json_body, me
from src.core.db import session_scope


class Call:
    """One request as a handler sees it: verb, query, body and caller."""

    def __init__(self, request: Any = None, operation: str = "") -> None:
        self.request = request
        self.operation = operation

    @property
    def method(self) -> str:
        """The HTTP verb, upper-case; `GET` when there is no request."""
        return (self.request.method if self.request is not None else "GET").upper()

    @cached_property
    def args(self) -> dict[str, Any]:
        """The query string as a flat dict."""
        return self.request.args.to_dict() if self.request is not None else {}

    @cached_property
    def body(self) -> dict[str, Any]:
        """The JSON object body; malformed JSON is a 400 (`core.auth.json_body`)."""
        return json_body()

    @cached_property
    def loose_body(self) -> Any:
        """The JSON body if it parses, else `None` — for handlers whose service
        validates the shape itself."""
        return self.request.get_json(silent=True) if self.request is not None else None

    @property
    def principal(self):
        return me()

    def run(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        """`fn(session, *args, principal=<caller>, **kwargs)` in one transaction."""
        principal = me()
        with session_scope() as session:
            return fn(session, *args, principal=principal, **kwargs)


def endpoint(fn: Callable[..., Any]) -> Callable[..., Any]:
    """Adapt `fn(call, **path_params)` to QF's handler signature."""

    @functools.wraps(fn)
    def handler(app: Any = None, operation: str = "", request: Any = None, **params: Any):
        return fn(Call(request, operation), **params)

    return handler
