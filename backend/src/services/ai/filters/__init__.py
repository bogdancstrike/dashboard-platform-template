"""Natural-language questions → the explorer's condition tree (§23, §42).
See docs/architecture/backend/filters.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "vocabulary": (
        "FEATURE", "MAX_QUESTION", "BUILDER_TYPE", "_PRESENCE_EMPTY", "_PRESENCE_NULL",
        "_EQUALITY", "_ORDERING", "_MEMBERSHIP", "BUILDER_OPERATOR", "_VALUELESS", "_WORDS",
        "DATE_FORMAT", "_new_id", "resolve_field", "resolve_operator",
    ),
    "values": (
        "_flat", "_choice", "_boolean", "_number", "_RELATIVE", "_moment", "_references",
        "coerce_values",
    ),
    "tree_shape": ("_Walk", "normalise"),
    "prompting": ("field_catalogue", "TREE_SCHEMA", "system_prompt", "heuristic_tree"),
    "compiler": ("compile_question", "_json"),
})
