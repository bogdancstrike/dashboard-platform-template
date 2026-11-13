"""The operators per field kind, and their aliases."""

from __future__ import annotations

from sqlalchemy import String, cast, func, or_

from src.core.errors import ValidationError

#: The full operator vocabulary of §4. `apply_filters` reads these off `__`
#: suffixes; `core/rules.py` compiles the query-builder tree into the same set,
#: so the simple filter bar and the advanced builder can never disagree about
#: what "starts with" means.
OPERATORS = frozenset(
    {
        "eq", "ne", "contains", "not", "starts", "ends",
        "gt", "gte", "lt", "lte", "between",
        "before", "after", "in", "not_in",
        "empty", "not_empty", "exists", "not_exists",
    }
)


_TEXTUAL = {"eq", "ne", "contains", "not", "starts", "ends", "in", "not_in", "empty", "not_empty", "exists", "not_exists"}


_ORDERED = {"eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "not_in", "empty", "not_empty", "exists", "not_exists"}


_TEMPORAL = {"eq", "ne", "before", "after", "gt", "gte", "lt", "lte", "between", "empty", "not_empty", "exists", "not_exists"}


_EXACT = {"eq", "ne", "in", "not_in", "empty", "not_empty", "exists", "not_exists"}


OPERATORS_BY_KIND: dict[str, frozenset[str]] = {
    "text": frozenset(_TEXTUAL),
    "json": frozenset(_TEXTUAL),
    "array": frozenset(_TEXTUAL),
    "enum": frozenset(_EXACT),
    "uuid": frozenset(_EXACT),
    "bool": frozenset({"eq", "ne", "empty", "not_empty"}),
    "number": frozenset(_ORDERED),
    "datetime": frozenset(_TEMPORAL),
}


#: Wire spellings the frontend query builder may send, mapped to the canonical
#: name. Keeping the alias table here means a UI library's vocabulary never
#: leaks into the SQL layer.
OPERATOR_ALIASES = {
    "equal": "eq", "equals": "eq", "==": "eq", "=": "eq", "select_equals": "eq",
    "not_equal": "ne", "!=": "ne", "<>": "ne", "select_not_equals": "ne",
    "like": "contains", "not_like": "not", "does_not_contain": "not",
    "starts_with": "starts", "ends_with": "ends",
    "greater": "gt", ">": "gt", "greater_or_equal": "gte", ">=": "gte",
    "less": "lt", "<": "lt", "less_or_equal": "lte", "<=": "lte",
    "range": "between", "between_dates": "between",
    "date_before": "before", "date_after": "after",
    "select_any_in": "in", "multiselect_equals": "in", "any_in": "in",
    "select_not_any_in": "not_in", "multiselect_not_equals": "not_in", "not_any_in": "not_in",
    "is_empty": "empty", "is_null": "empty", "is_not_empty": "not_empty",
    "is_not_null": "not_empty", "is_true": "eq", "is_false": "ne",
}


def canonical_operator(raw: str) -> str:
    key = str(raw or "").strip().lower()
    key = OPERATOR_ALIASES.get(key, key)
    if key not in OPERATORS:
        raise ValidationError(
            f"{raw!r} is not a filter operator; use one of " + ", ".join(sorted(OPERATORS))
        )
    return key


#: How PostgreSQL renders an *empty* collection when a JSON or array column is
#: cast to text. An absence, not a value: "records with no tags" has to find
#: the record whose tags are `{}` as well as the one whose tags are NULL.
_EMPTY_RENDERINGS = ("{}", "[]", "null")


def _blank(column, kind: str):
    """"Empty" means empty *or* absent: a NULL description and an empty-string
    description are the same absence to whoever is asking.

    And an empty *collection* is the same absence again. `json` and `array`
    columns are compared as their rendered text, and an empty array renders as
    `{}` — two characters, so a length test alone called it a value and
    "records with no tags" quietly answered only the ones whose column was
    NULL. Found by the operator matrix in `tests/test_query.py`, which is the
    first thing to ask every operator about every kind.
    """
    if kind in ("json", "array"):
        rendered = func.trim(cast(column, String))
        return or_(
            column.is_(None),
            func.length(rendered) == 0,
            rendered.in_(_EMPTY_RENDERINGS),
        )
    if kind == "text":
        return or_(column.is_(None), func.length(func.trim(cast(column, String))) == 0)
    return column.is_(None)
