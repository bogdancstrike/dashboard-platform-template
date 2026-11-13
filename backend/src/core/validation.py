"""Declarative request validation: a `Schema` of `Field`s, each with a cleaner.

A service describes its payload once — which fields exist, how each one is
cleaned, which are only read when sent — and `Schema.validate` does the
walking: the object check, unknown-field refusal, partial updates (a `PUT`
touches only what it names) and cross-field checks. Cleaners live in
`core/cleaners.py`; they are `(value, ctx) -> cleaned` and raise
`ValidationError` with the message the client shows.
See docs/architecture/backend/validation.md.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field
from typing import Any, Callable, Iterable

from src.core.errors import ValidationError

Cleaner = Callable[[Any, "Context"], Any]
Check = Callable[[dict[str, Any], "Context"], None]
#: A schema entry is a `Field`, or a step `(out, ctx) -> None` run in its place
#: in the order — for a rule that reads or writes several fields at once.
Entry = "Field | Check"


@dataclass
class Context:
    """What a cleaner may consult beyond its own value."""

    payload: dict[str, Any]
    partial: bool = False
    principal: Any = None
    existing: Any = None
    extra: dict[str, Any] = dc_field(default_factory=dict)

    def sent(self, name: str) -> bool:
        return name in self.payload

    def wants(self, name: str) -> bool:
        """A create sets every field; an update only the ones it names."""
        return not self.partial or name in self.payload

    def value(self, name: str, default: Any = None, *, inherit: bool = False) -> Any:
        """The sent value, else the existing row's (when `inherit`), else `default`."""
        if inherit and self.existing is not None:
            return self.payload.get(name, getattr(self.existing, name, default))
        return self.payload.get(name, default)


@dataclass(frozen=True)
class Field:
    """One payload field.

    `sparse` fields are read only when sent, even on a create; `always`
    fields are cleaned on every save (so a stale combination is refused) but
    stored only when wanted; `inherit` reads the existing row's value for an
    absent field.
    """

    name: str
    clean: Cleaner
    default: Any = None
    sparse: bool = False
    always: bool = False
    inherit: bool = False

    def applies(self, ctx: Context) -> bool:
        return ctx.sent(self.name) if self.sparse else ctx.wants(self.name)


class Schema:
    """An ordered set of fields plus the checks that span several of them."""

    def __init__(
        self,
        fields: Iterable[Field | Check],
        *,
        not_object: str | None = None,
        unknown: str | None = None,
        unknown_lists_allowed: bool = False,
        extra_allowed: Iterable[str] = (),
        checks: Iterable[Check] = (),
    ) -> None:
        self.fields = tuple(fields)
        self.not_object = not_object
        self.unknown = unknown
        self.unknown_lists_allowed = unknown_lists_allowed
        self.allowed = {f.name for f in self.fields if isinstance(f, Field)} | set(extra_allowed)
        self.checks = tuple(checks)

    def context(self, payload: Any, **kwargs: Any) -> Context:
        """The checked payload wrapped for cleaners: object check, unknown fields."""
        if not isinstance(payload, dict):
            if self.not_object is not None:
                raise ValidationError(self.not_object)
            payload = {}
        if self.unknown is not None:
            unknown = sorted(set(payload) - self.allowed)
            if unknown:
                details: dict[str, Any] = {"fields": unknown}
                if self.unknown_lists_allowed:
                    details["allowed"] = sorted(self.allowed)
                raise ValidationError(self.unknown, details=details)
        extra = kwargs.pop("extra", None) or {}
        return Context(payload=payload, extra=extra, **kwargs)

    def validate(self, payload: Any, *, partial: bool = False, principal: Any = None,
                 existing: Any = None, **extra: Any) -> dict[str, Any]:
        ctx = self.context(payload, partial=partial, principal=principal,
                           existing=existing, extra=extra)
        return self.clean(ctx)

    def clean(self, ctx: Context) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for item in self.fields:
            if not isinstance(item, Field):
                item(out, ctx)
                continue
            applies = item.applies(ctx)
            if not (applies or item.always):
                continue
            value = item.clean(ctx.value(item.name, item.default, inherit=item.inherit), ctx)
            if applies:
                out[item.name] = value
        for check in self.checks:
            check(out, ctx)
        return out
