"""Schema steps every shareable resource (saved search, report, dashboard) repeats.

The visibility step checks the share permission only on a *change*: a role
losing it must not make its owner's existing shared items unsavable.
"""

from __future__ import annotations

from typing import Any

from src.core import sharing


def scope_step(share_permission: str):
    def step(out: dict[str, Any], ctx) -> None:
        existing, payload = ctx.existing, ctx.payload
        changing = existing is None or str(payload.get("scope", existing.scope)).upper() != existing.scope
        scope = sharing.scope_of(
            payload.get("scope", existing.scope if existing else "PRIVATE"),
            principal=ctx.principal if changing else None,
            share_permission=share_permission,
        )
        if ctx.wants("scope"):
            out["scope"] = scope

    return step


def members_step(share_permission: str):
    def step(out: dict[str, Any], ctx) -> None:
        if not ctx.wants("member_ids"):
            return
        wanted = sharing.requested_members(ctx.payload)
        if wanted:
            ctx.principal.require(share_permission)
        out["member_ids"] = wanted

    return step
