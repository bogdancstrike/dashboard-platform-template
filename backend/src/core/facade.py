"""Lazy package facades (PEP 562).

A package split into submodules keeps one public import path —
`workflows.create(...)` after importing the `workflows` package — without
its `__init__` importing every submodule. Eager re-exports turn two packages
that use each other's submodules into an import cycle at package level even
when the modules themselves form a tree; resolving a name on first use does not.

    __getattr__, __dir__, __all__ = lazy(__name__, {
        "commands": ("create", "update"),
        "queries": ("get", "list_rules"),
    })
"""

from __future__ import annotations

from importlib import import_module
from typing import Any, Callable, Iterable


def lazy(package: str, exports: dict[str, Iterable[str]]) -> tuple[
        Callable[[str], Any], Callable[[], list[str]], list[str]]:
    """`__getattr__`, `__dir__` and `__all__` for `package`, from submodule -> names."""
    where = {name: module for module, names in exports.items() for name in names}

    def __getattr__(name: str) -> Any:
        module = where.get(name)
        if module is None:
            raise AttributeError(f"module {package!r} has no attribute {name!r}")
        # Not cached on the package: a module-level variable (a snapshot, a
        # registry) must read as it is now, not as it was on first use.
        return getattr(import_module(f"{package}.{module}"), name)

    def __dir__() -> list[str]:
        return sorted(where)

    return __getattr__, __dir__, sorted(where)
