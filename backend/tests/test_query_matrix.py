"""`core/query.py` — one test per operator per field kind, and the subtle ones. — the matrix."""

from __future__ import annotations

import pytest

from src.core.errors import ValidationError
from src.core.query import (
    MAX_FILTER_VALUES,
    OPERATORS,
    OPERATORS_BY_KIND,
    Field,
    build_predicate,
    canonical_operator,
)
from tests.query_support import (  # noqa: F401
    ONE,
    SAMPLE,
    TWO,
    filtered,
    matching,
    probe,
    spec,
)


@pytest.mark.database
@pytest.mark.parametrize(
    ("kind", "operator"),
    [
        (kind, operator)
        for kind, operators in sorted(OPERATORS_BY_KIND.items())
        for operator in sorted(operators)
    ],
)
def test_every_operator_a_kind_claims_runs_on_that_kind(kind, operator, spec, matching):
    """The catalogue tells the query builder which operators a column accepts.

    `FieldSet.describe` publishes `OPERATORS_BY_KIND` straight to the frontend,
    so a pair in that table which PostgreSQL refuses is a 500 the *product*
    invited by advertising it. Asserted by running each one, because the
    failures here are database errors — casting a UUID column with `lower()`,
    comparing a JSONB to a number — and no amount of reading catches those.
    """
    field = next(one for one in spec.fields if one.kind == kind)
    value = SAMPLE[kind]
    # `between` is the one operator that needs two values to mean anything.
    raw = f"{value},{value}" if operator == "between" else value
    matching(build_predicate(field, operator, raw))


@pytest.mark.database
def test_the_matrix_covers_the_vocabulary(spec):
    """Every operator in `OPERATORS` appears somewhere in `OPERATORS_BY_KIND`.

    Otherwise the matrix above passes while an operator the filter bar accepts
    is claimed by no kind at all — testable and untested.
    """
    claimed = {operator for operators in OPERATORS_BY_KIND.values() for operator in operators}
    assert claimed == set(OPERATORS)
    # And every kind in the table is a kind some field can be declared as.
    assert set(OPERATORS_BY_KIND) == {one.kind for one in spec.fields} | {"text"}


@pytest.mark.database
@pytest.mark.parametrize("operator", ["ne", "not_in", "not"])
def test_excluding_a_value_keeps_the_rows_that_have_none(operator, spec, matching):
    """Row 3 has no name, so it is not "a row named Ana Pop"."""
    field = spec.by_name["name"]
    assert 3 in matching(build_predicate(field, operator, "Ana Pop"))


@pytest.mark.database
def test_excluding_an_enum_value_keeps_the_rows_that_have_none(spec, matching):
    # The same claim one kind over, because the exact-comparison branch is a
    # different one from the text branch — `notin_` on a NULL column is where
    # SQL's three-valued logic bites.
    assert matching(build_predicate(spec.by_name["status"], "not_in", "OPEN")) == [2, 3, 4]


@pytest.mark.database
def test_empty_means_empty_or_absent(spec, matching):
    """A NULL name and an empty-string name are the same absence."""
    assert matching(build_predicate(spec.by_name["name"], "empty", "")) == [3, 4]
    # And `not_empty` is exactly the complement, which is what makes the pair
    # usable as a two-way filter rather than two overlapping ones.
    assert matching(build_predicate(spec.by_name["name"], "not_empty", "")) == [1, 2]
    # An empty *collection* is an absence too. This is what the matrix found:
    # an array column is compared as its rendered text, an empty array renders
    # as `{}`, and a length test called that a value — so "records with no
    # tags" answered only the rows whose column was NULL (§37).
    assert matching(build_predicate(spec.by_name["tags"], "empty", "")) == [3, 4]
    assert matching(build_predicate(spec.by_name["tags"], "not_empty", "")) == [1, 2]
    assert matching(build_predicate(spec.by_name["meta"], "empty", "")) == [3, 4]


@pytest.mark.database
def test_empty_on_a_kind_with_no_empty_value_means_null(spec, matching):
    # A number has no "" — 0 is a value, and a filter that treated it as
    # absence would hide row 4 from a reader asking for rows *with* a score.
    assert matching(build_predicate(spec.by_name["score"], "empty", "")) == [3]
    assert matching(build_predicate(spec.by_name["score"], "not_empty", "")) == [1, 2, 4]


@pytest.mark.database
def test_text_equality_ignores_case(spec, matching):
    assert matching(build_predicate(spec.by_name["name"], "eq", "ANA POP")) == [1, 2]
    # `in` is the same comparison over several values, and gets the same rule.
    assert matching(build_predicate(spec.by_name["name"], "in", "ana POP")) == [1, 2]


@pytest.mark.database
def test_text_operators_select_what_they_say(spec, matching):
    field = spec.by_name["name"]
    assert matching(build_predicate(field, "contains", "na po")) == [1, 2]
    assert matching(build_predicate(field, "starts", "ana")) == [1, 2]
    assert matching(build_predicate(field, "ends", "pop")) == [1, 2]
    assert matching(build_predicate(field, "not", "ana")) == [3, 4]


@pytest.mark.database
def test_number_operators_compare_numerically(spec, matching):
    field = spec.by_name["score"]
    # Not as text: "50" < "6" as a string, and a score filter that sorted
    # lexicographically would be wrong in a way nobody notices until it is
    # a money column.
    assert matching(build_predicate(field, "gt", "6")) == [2]
    assert matching(build_predicate(field, "lte", "5")) == [1, 4]
    assert matching(build_predicate(field, "between", "1,49")) == [1]
    # Reversed bounds are a slip, not an empty answer.
    assert matching(build_predicate(field, "between", "49,1")) == [1]


@pytest.mark.database
def test_datetime_operators_accept_dates_and_instants(spec, matching):
    field = spec.by_name["at"]
    assert matching(build_predicate(field, "before", "2026-02-01")) == [1]
    assert matching(build_predicate(field, "after", "2026-02-01")) == [2, 4]
    assert matching(build_predicate(field, "between", "2026-01-01,2026-02-28")) == [1, 2]
    # A bare date means midnight UTC, so a naive boundary can be compared with
    # a timestamptz column at all.
    assert matching(build_predicate(field, "gte", "2026-03-05")) == [4]


@pytest.mark.database
def test_bool_and_uuid_operators(spec, matching):
    assert matching(build_predicate(spec.by_name["flag"], "eq", "true")) == [1, 4]
    assert matching(build_predicate(spec.by_name["flag"], "ne", "true")) == [2, 3]
    assert matching(build_predicate(spec.by_name["ref"], "in", f"{ONE},{TWO}")) == [1, 2]


@pytest.mark.database
def test_json_and_array_are_compared_as_their_rendered_text(spec, matching):
    # Cheap enough for a filter nobody runs in a loop, and the alternative is a
    # generated column plus a migration per filter — the reasoning `Field`
    # gives. What matters here is that it *works* on both kinds.
    assert matching(build_predicate(spec.by_name["meta"], "contains", '"a": 1')) == [1]
    assert matching(build_predicate(spec.by_name["tags"], "contains", "x")) == [1]


@pytest.mark.database
def test_an_operator_a_kind_cannot_honour_is_refused_with_the_alternatives(spec):
    with pytest.raises(ValidationError) as raised:
        build_predicate(spec.by_name["score"], "contains", "5")
    # The message names the field, its kind and what it *can* do: a refusal
    # that only says "no" sends somebody to read the source.
    assert "score" in str(raised.value)
    assert "between" in str(raised.value)


def test_an_unknown_operator_names_the_vocabulary():
    with pytest.raises(ValidationError) as raised:
        canonical_operator("sounds_like")
    assert "starts" in str(raised.value)


def test_the_query_builders_spellings_map_onto_the_same_operators():
    # The frontend library sends its own names; the SQL layer never learns
    # them. Two spellings of one operator is how a filter ends up meaning
    # different things in the two places it can be built.
    assert canonical_operator("select_any_in") == "in"
    assert canonical_operator("NOT_LIKE") == "not"
    assert canonical_operator("is_null") == "empty"


def test_a_filter_value_can_be_neither_endless_nor_a_pasted_column():
    field = Field("name", None)
    with pytest.raises(ValidationError):
        build_predicate(field, "eq", "x" * 501)
    with pytest.raises(ValidationError):
        build_predicate(field, "in", ",".join(["x"] * (MAX_FILTER_VALUES + 1)))


@pytest.mark.database
def test_a_value_of_the_wrong_type_is_a_refusal_not_a_database_error(spec):
    for name, value in (("score", "high"), ("at", "yesterday"), ("ref", "not-a-uuid")):
        with pytest.raises(ValidationError):
            build_predicate(spec.by_name[name], "eq", value)
