"""Query-builder trees → SQL, and → readable text.
See docs/architecture/backend/rules.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "compiling": (
        "MAX_DEPTH", "MAX_RULES", "_TEXT_OPERATOR", "_VALUELESS", "_children", "_rule_parts",
        "_Counter", "compile_tree", "_compile_node",
    ),
    "describing": ("describe_tree", "_describe_node", "_literal"),
    "counting": ("rule_count", "always"),
})
