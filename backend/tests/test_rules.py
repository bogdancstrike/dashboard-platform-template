"""The query-builder tree, compiled and described (§4, §51).

`compile_tree` and `describe_tree` are the two readings of one structure: the
SQL that runs, and the text the inspector shows. The tests that matter here are
the ones that would catch them drifting apart, and the ones that pin the
behaviour an editor depends on — an unfinished rule narrows nothing rather than
failing the request that is rendering the results behind it.
"""

from __future__ import annotations

import pytest
from sqlalchemy import Column, DateTime, Integer, MetaData, String, Table, select

from src.core.errors import ValidationError
from src.core.query import OPERATORS, OPERATORS_BY_KIND, Field, FieldSet, canonical_operator
from src.core.rules import MAX_DEPTH, compile_tree, describe_tree, rule_count

_metadata = MetaData()
_records = Table(
    "records", _metadata,
    Column("id", Integer, primary_key=True),
    Column("title", String),
    Column("status", String),
    Column("score", Integer),
    Column("seen_at", DateTime(timezone=True)),
)

FIELDS = FieldSet(
    Field("title", _records.c.title, searchable=True),
    Field("status", _records.c.status, kind="enum", choices=("OPEN", "DONE")),
    Field("score", _records.c.score, kind="number"),
    Field("seen_at", _records.c.seen_at, kind="datetime", label="Seen"),
)


def rule(field: str, operator: str, *values):
    return {"type": "rule", "properties": {"field": field, "operator": operator, "value": list(values)}}


def group(conjunction: str, *children, negated: bool = False):
    return {
        "type": "group",
        "properties": {"conjunction": conjunction, "not": negated},
        "children1": {f"child-{index}": child for index, child in enumerate(children)},
    }


def sql_of(tree) -> str:
    predicate = compile_tree(tree, FIELDS)
    assert predicate is not None
    return str(select(_records).where(predicate).compile(compile_kwargs={"literal_binds": True}))


# ── the contract between the two readings ────────────────────────────────


def test_the_inspector_names_every_field_and_operator_the_sql_uses():
    """The inspector's promise is that it cannot describe a different query
    from the one that ran, so both readings must mention the same fields."""
    tree = group(
        "AND",
        rule("status", "select_equals", "OPEN"),
        group(
            "OR",
            rule("score", "greater", 10),
            rule("title", "like", "migration"),
            negated=True,
        ),
    )

    described = describe_tree(tree, FIELDS)
    statement = sql_of(tree)

    for column in ("status", "score", "title"):
        assert column in statement
    for label in ("Status", "Score", "Title"):
        assert label in described
    assert "=" in described and "contains" in described and ">" in described
    assert "NOT" in described and "NOT" in statement.upper()


def test_the_field_catalogue_publishes_only_operators_the_compiler_accepts():
    """The builder is generated from `describe()`; an operator published there
    that `build_predicate` refuses would be a rule nobody can complete."""
    for described in FIELDS.describe():
        allowed = OPERATORS_BY_KIND[described["kind"]]
        assert described["operators"], f"{described['name']} publishes no operators"
        for operator in described["operators"]:
            assert operator in OPERATORS
            assert operator in allowed
            # Reachable from the wire spelling the frontend sends, too.
            assert canonical_operator(operator) == operator


def test_every_operator_in_the_vocabulary_belongs_to_some_kind():
    covered = set().union(*OPERATORS_BY_KIND.values())
    assert covered == set(OPERATORS)


# ── what an editor in mid-edit sends ─────────────────────────────────────


@pytest.mark.parametrize(
    "tree",
    [
        pytest.param(None, id="no tree"),
        pytest.param(group("AND"), id="empty group"),
        pytest.param(group("AND", {"type": "rule", "properties": {}}), id="no field yet"),
        pytest.param(group("AND", rule("status", "select_equals")), id="no value yet"),
        pytest.param(group("AND", rule("title", "like", "")), id="blank value"),
    ],
)
def test_an_unfinished_rule_narrows_nothing_rather_than_failing(tree):
    assert compile_tree(tree, FIELDS) is None
    assert describe_tree(tree, FIELDS).strip() == ""


def test_a_finished_rule_beside_an_unfinished_one_still_applies():
    tree = group("AND", rule("status", "select_equals", "OPEN"), {"type": "rule", "properties": {}})

    statement = sql_of(tree)

    assert "status" in statement and "OPEN" in statement


# ── limits ───────────────────────────────────────────────────────────────


def test_a_tree_deeper_than_the_limit_is_refused_with_a_message():
    tree = rule("status", "select_equals", "OPEN")
    for _ in range(MAX_DEPTH + 1):
        tree = group("AND", tree)

    with pytest.raises(ValidationError) as failure:
        compile_tree(tree, FIELDS)

    assert "nest at most" in str(failure.value)


def test_an_unknown_field_names_what_is_available():
    with pytest.raises(ValidationError) as failure:
        compile_tree(rule("secret", "equal", "x"), FIELDS)

    assert failure.value.details["available"] == sorted(FIELDS.by_name)


def test_rule_count_matches_what_a_saved_search_shows():
    tree = group("AND", rule("status", "select_equals", "OPEN"),
                 group("OR", rule("score", "greater", 1), rule("score", "less", 9)))

    assert rule_count(tree) == 3
