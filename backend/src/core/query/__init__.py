"""Declarative search, filter, sort and facets for every list endpoint.
See docs/architecture/backend/query.md."""

from __future__ import annotations

from src.core.facade import lazy

__getattr__, __dir__, __all__ = lazy(__name__, {
    "fields": ("MAX_FILTER_CHARS", "MAX_FILTER_VALUES", "KINDS", "Field", "FieldSet"),
    "values": ("_as_text", "_values", "_number", "_moment", "_uuids", "_typed"),
    "operators": (
        "OPERATORS", "_TEXTUAL", "_ORDERED", "_TEMPORAL", "_EXACT", "OPERATORS_BY_KIND",
        "OPERATOR_ALIASES", "canonical_operator", "_EMPTY_RENDERINGS", "_blank",
    ),
    "predicates": ("build_predicate", "_default_predicate"),
    "statements": ("_blank_argument", "apply_filters", "apply_sort", "count_of", "facets_for"),
})
