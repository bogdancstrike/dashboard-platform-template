"""Named extension points (observer pattern) that let a lower module call upward.

A module that has something to announce — a record was written, the
notification badges are being counted — declares a `Hook` and emits it. The
features that care connect to it from their own module, so the dependency
points from the subscriber to the publisher and never back. The subscribers
are imported once by the composition root (`src/services/wiring.py`).
See docs/architecture/backend/events.md.
"""

from __future__ import annotations

from typing import Any, Callable

Handler = Callable[..., Any]


class Hook:
    """An ordered list of handlers called with the same arguments."""

    def __init__(self, name: str) -> None:
        self.name = name
        self._handlers: list[Handler] = []

    def connect(self, handler: Handler) -> Handler:
        """Register `handler` (idempotent); usable as a decorator."""
        if handler not in self._handlers:
            self._handlers.append(handler)
        return handler

    def disconnect(self, handler: Handler) -> None:
        if handler in self._handlers:
            self._handlers.remove(handler)

    @property
    def handlers(self) -> tuple[Handler, ...]:
        return tuple(self._handlers)

    def emit(self, *args: Any, **kwargs: Any) -> list[Any]:
        """Call every handler in registration order; their answers, in order."""
        return [handler(*args, **kwargs) for handler in self._handlers]

    def first(self, *args: Any, **kwargs: Any) -> Any:
        """The first handler answer that is not `None` (later ones are not called)."""
        for handler in self._handlers:
            answer = handler(*args, **kwargs)
            if answer is not None:
                return answer
        return None

    def __repr__(self) -> str:
        return f"Hook({self.name!r}, {len(self._handlers)} handler(s))"
