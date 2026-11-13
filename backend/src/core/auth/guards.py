"""Endpoint guards. QF calls handlers as `fn(app=..., operation=..., request=..., **path_params)`; these keep that signature."""

from __future__ import annotations

import functools

from flask import g

from src.core.auth import caller
from src.core.errors import ForbiddenError, UnauthorizedError


def authenticated(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        caller.principal_from_request(required=True)
        return fn(*args, **kwargs)

    return wrapper


def requires(*permissions: str):
    """Guard an endpoint with one or more permissions (all must be held)."""

    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            principal = caller.principal_from_request(required=True)
            principal.require(*permissions)
            return fn(*args, **kwargs)

        wrapper.__platform_permissions__ = permissions
        return wrapper

    return decorator


def optional(fn):
    """Public endpoint that still wants to know the caller when there is one."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            caller.principal_from_request(required=False)
        except (UnauthorizedError, ForbiddenError):
            g.principal = None
        return fn(*args, **kwargs)

    return wrapper
