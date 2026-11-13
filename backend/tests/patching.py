"""Patching a name in a service that is split into a package of submodules.

A package facade (`core.facade.lazy`) resolves names on first use, and each
submodule binds the names it imports — so patching the facade alone changes
nothing the code reads. `patch_package` patches every submodule that binds the
name, and the facade.
"""

from __future__ import annotations

import importlib
import pkgutil
from types import ModuleType
from typing import Any


def patch_package(monkeypatch, package: ModuleType, name: str, value: Any) -> None:
    # Import every submodule before patching any: a module imported mid-way
    # would bind the patched value and keep it as its "original".
    modules = [importlib.import_module(info.name)
               for info in pkgutil.walk_packages(package.__path__, package.__name__ + ".")]
    hits = 0
    for module in modules:
        if name in vars(module):
            monkeypatch.setattr(module, name, value)
            hits += 1
    monkeypatch.setattr(package, name, value, raising=False)
    assert hits, f"{package.__name__} binds no {name!r}"
