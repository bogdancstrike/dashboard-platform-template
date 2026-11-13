# `src/core/rules`

Query-builder trees → SQL, and → readable text.

The advanced search screen (§4) and the alert-rule editor (§49) both build a
nested condition tree in the browser with react-awesome-query-builder. This
module is the one place that tree turns into anything else:

  * `compile_tree`  → a SQLAlchemy predicate, so nested AND/OR groups execute
                      in PostgreSQL like every other filter (§71);
  * `describe_tree` → the parenthesised text the query inspector shows (§51).

Both walk the same structure, so the text a user reads is provably the shape of
the SQL that ran — the entire point of an inspector is that it cannot drift
from what was executed.

Accepted shape (react-awesome-query-builder's native tree):

    {"type": "group", "conjunction": "AND", "not": false, "children1": {
        "a1": {"type": "rule", "properties": {
            "field": "status", "operator": "select_equals", "value": ["ACTIVE"]}},
        "a2": {"type": "group", "conjunction": "OR", "children1": [...]}}}

`children1` and `children` are both honoured, as dict (id → node) or list,
because the library emits both depending on export helper.
