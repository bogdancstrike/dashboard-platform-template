"""`core/query.py` — one test per operator per field kind, and the subtle ones.

Every list in the product is filtered, sorted, searched and faceted by this one
module, and it had no unit tests: it was exercised only through endpoints, each
of which uses a handful of operators on a handful of columns. That leaves the
combinations nobody happened to build a page for — `not_in` on an array, `ne`
on a nullable enum — unasserted, and those are exactly the ones that return
*plausible* wrong rows rather than an error.

Three claims are worth more than the matrix, and each is a bug this module was
written to avoid:

**Excluding a value must not exclude the rows that have none.** SQL says
`NULL <> 'X'` is unknown, so a plain `column != 'X'` silently drops every row
whose column is empty. "Not assigned to Ana" has to include the unassigned.

**Empty means empty *or* absent.** A NULL description and an empty-string
description are the same absence to whoever is asking, and a filter that
distinguished them would be asking about the storage rather than the record.

**Text equality is case-insensitive.** A filter box is not a database console;
nobody types a name with the right capitals.

Against a real PostgreSQL, on a scratch table of one column per kind. Real,
because the claims are about what *PostgreSQL* does with NULL and with
`lower()` — an assertion against a compiled string would only prove the module
agrees with itself. Scratch, because the rows have to include a NULL, an empty
string and two spellings of one value, and the seeded demo data cannot be bent
into that shape without changing what every other test sees.
"""

from __future__ import annotations

from uuid import UUID

import pytest
from sqlalchemy import (
    ARRAY,
    Boolean,
    Column,
    DateTime,
    Integer,
    MetaData,
    String,
    Table,
    select,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PgUUID

from src.core.errors import ValidationError
from src.core.pagination import Page
from src.core.query import (
    MAX_FILTER_VALUES,
    OPERATORS,
    OPERATORS_BY_KIND,
    Field,
    FieldSet,
    apply_filters,
    apply_sort,
    build_predicate,
    canonical_operator,
    count_of,
    facets_for,
)

ONE = UUID("11111111-1111-1111-1111-111111111111")
TWO = UUID("22222222-2222-2222-2222-222222222222")
THREE = UUID("33333333-3333-3333-3333-333333333333")

#: The rows every assertion below is written against.
#:
#: Row 1 and row 2 differ only in the *case* of their name, which is what makes
#: the case-insensitivity claim checkable. Row 3 is empty in every column —
#: the row that a naive `!=` drops. Row 4 carries an empty *string* and an
#: empty array, which is a different absence from row 3's NULL and must be
#: treated as the same one.
ROWS = (
    (1, "Ana Pop", "OPEN", 5, True, "2026-01-10T09:00:00+00:00", ONE, {"a": 1}, ["x", "y"]),
    (2, "ana pop", "CLOSED", 50, False, "2026-02-20T09:00:00+00:00", TWO, {"b": 2}, ["y"]),
    (3, None, None, None, None, None, None, None, None),
    (4, "", "BLOCKED", 0, True, "2026-03-05T09:00:00+00:00", THREE, {}, []),
)


@pytest.fixture()
def probe(engine):
    """A table of one column per field kind, dropped however the test ends."""
    metadata = MetaData()
    table = Table(
        "query_probe",
        metadata,
        Column("id", Integer, primary_key=True),
        Column("name", String(64)),
        Column("status", String(16)),
        Column("score", Integer),
        Column("flag", Boolean),
        Column("at", DateTime(timezone=True)),
        Column("ref", PgUUID(as_uuid=True)),
        Column("meta", JSONB),
        Column("tags", ARRAY(String(32))),
    )
    with engine.begin() as connection:
        connection.execute(text('DROP TABLE IF EXISTS "query_probe"'))
        metadata.create_all(connection)
        connection.execute(
            table.insert(),
            [
                dict(zip(
                    ("id", "name", "status", "score", "flag", "at", "ref", "meta", "tags"),
                    row,
                    strict=True,
                ))
                for row in ROWS
            ],
        )
    yield table
    with engine.begin() as connection:
        connection.execute(text('DROP TABLE IF EXISTS "query_probe"'))


@pytest.fixture()
def spec(probe):
    return FieldSet(
        Field("id", probe.c.id, kind="number"),
        Field("name", probe.c.name, searchable=True),
        Field("status", probe.c.status, kind="enum", facet=True, choices=("OPEN", "CLOSED")),
        Field("score", probe.c.score, kind="number"),
        Field("flag", probe.c.flag, kind="bool"),
        Field("at", probe.c.at, kind="datetime"),
        Field("ref", probe.c.ref, kind="uuid"),
        Field("meta", probe.c.meta, kind="json"),
        Field("tags", probe.c.tags, kind="array"),
    )


@pytest.fixture()
def matching(engine, probe):
    """The ids a predicate selects, in order — the answer every test reads."""

    def run(predicate) -> list[int]:
        statement = select(probe.c.id).order_by(probe.c.id)
        if predicate is not None:
            statement = statement.where(predicate)
        with engine.connect() as connection:
            return [row[0] for row in connection.execute(statement).all()]

    return run


@pytest.fixture()
def filtered(engine, probe, spec):
    """The ids `apply_filters` selects for a set of query parameters."""

    def run(args: dict) -> list[int]:
        statement = apply_filters(select(probe.c.id), args, spec)
        with engine.connect() as connection:
            return [row[0] for row in connection.execute(statement.order_by(probe.c.id)).all()]

    return run


# ── the matrix ───────────────────────────────────────────────────────────

#: A value of the right shape for each kind, so an operator can be *run*.
SAMPLE = {
    "text": "ana pop",
    "enum": "OPEN",
    "number": "5",
    "bool": "true",
    "datetime": "2026-01-10T09:00:00+00:00",
    "uuid": str(ONE),
    "json": "1",
    "array": "y",
}


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


# ── the three subtle claims ──────────────────────────────────────────────


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


# ── the operators, by hand where the answer is worth naming ──────────────


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


# ── refusals ─────────────────────────────────────────────────────────────


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


# ── the parameter layer ──────────────────────────────────────────────────


@pytest.mark.database
def test_a_bare_parameter_means_what_the_kind_says_it_means(filtered):
    # Text contains, enum is exact, number is exact, datetime is that *day*.
    assert filtered({"name": "ana"}) == [1, 2]
    assert filtered({"status": "OPEN"}) == [1]
    assert filtered({"score": "5"}) == [1]
    assert filtered({"at": "2026-01-10"}) == [1]
    assert filtered({"flag": "false"}) == [2]


@pytest.mark.database
def test_a_cleared_filter_does_not_narrow_by_nothing(filtered):
    """`[]` and `""` mean "do not narrow by this", not "match nothing".

    A cleared multi-select sends an empty array, and a page that read that as
    a filter would answer an empty table to a reader who had just widened
    their question.
    """
    everything = [1, 2, 3, 4]
    assert filtered({}) == everything
    assert filtered({"status": []}) == everything
    assert filtered({"status": ""}) == everything
    assert filtered({"name": [" "]}) == everything


@pytest.mark.database
def test_a_list_valued_filter_is_the_same_as_a_comma_separated_one(filtered):
    # Filters arrive as text from a query string and as arrays from a JSON
    # body. `str(["A", "B"])` is `"['A', 'B']"`, which matches nothing — a
    # filter that silently empties the table rather than failing.
    assert filtered({"status": ["OPEN", "CLOSED"]}) == filtered({"status": "OPEN,CLOSED"}) == [1, 2]


@pytest.mark.database
def test_ranges_ride_in_as_min_max_and_from_to(filtered):
    assert filtered({"score_min": "1", "score_max": "49"}) == [1]
    assert filtered({"at_from": "2026-02-01"}) == [2, 4]
    assert filtered({"at_to": "2026-01-31"}) == [1]


@pytest.mark.database
def test_two_clauses_on_one_field_narrow_together(filtered):
    # "at least this but not that" is among the most common things anybody
    # asks, and it needs the plain range filter and the explicit operator to
    # compose rather than the second replacing the first.
    assert filtered({"score_min": "1", "score__lt": "50"}) == [1]
    assert filtered({"name": "pop", "name__empty": "true"}) == []


@pytest.mark.database
def test_free_text_search_covers_only_the_searchable_fields(filtered):
    assert filtered({"q": "ana"}) == [1, 2]
    # `status` is not searchable, so `q` does not reach it — a `q` that
    # silently matched an enum or a UUID prefix looks broken to whoever typed
    # it.
    assert filtered({"q": "BLOCKED"}) == []


@pytest.mark.database
def test_an_unknown_parameter_is_ignored_rather_than_refused(filtered):
    # A stale bookmark carrying a filter a page no longer has is a page that
    # still works.
    assert filtered({"nonsense": "x", "nonsense__eq": "x"}) == [1, 2, 3, 4]


# ── sort, count and facets ───────────────────────────────────────────────


@pytest.mark.database
def test_sorting_keeps_nulls_out_of_the_readers_way(engine, probe, spec):
    def ids(sort: str, order: str) -> list[int]:
        page = Page(page=1, page_size=10, sort=sort, order=order)
        statement = apply_sort(select(probe.c.id), page, spec, default="id")
        with engine.connect() as connection:
            return [row[0] for row in connection.execute(statement).all()]

    # Descending is "most interesting first", and an undated row is never the
    # most interesting one.
    assert ids("at", "desc") == [4, 2, 1, 3]
    assert ids("at", "asc") == [3, 1, 2, 4]
    # A sort by a column that does not exist falls back rather than failing:
    # the alternative is a 400 for a URL somebody bookmarked.
    assert ids("nonsense", "asc") == [1, 2, 3, 4]


@pytest.mark.database
def test_a_sort_is_a_total_order_even_when_the_column_ties(engine, probe, spec):
    """Two rows with the same value have no defined position without a tiebreak.

    PostgreSQL is free to return them in a different order per query, so page 2
    of an OFFSET scan can repeat a row from page 1 and never show another one.
    `apply_sort` appends the identity column for exactly this.
    """
    page = Page(page=1, page_size=10, sort="flag", order="desc")
    statement = apply_sort(select(probe.c.id), page, spec, default="id")
    compiled = str(statement.compile(engine))
    assert "query_probe.id ASC" in compiled


@pytest.mark.database
def test_multi_column_sort_applies_the_orders_it_is_given(engine, probe, spec):
    page = Page(page=1, page_size=10, sort="flag,score", order="asc,desc")
    statement = apply_sort(select(probe.c.id), page, spec, default="id")
    with engine.connect() as connection:
        # `flag` ascending puts the NULL first and `false` before `true`; the
        # two `true` rows are then ordered by score descending.
        assert [row[0] for row in connection.execute(statement).all()] == [3, 2, 1, 4]


@pytest.mark.database
def test_the_count_ignores_the_page_and_the_facets_follow_the_filters(engine, probe, spec):
    statement = apply_filters(select(probe.c.id), {"name": "pop"}, spec)
    with engine.connect() as connection:
        from sqlalchemy.orm import Session

        session = Session(bind=connection)
        # The total is over the *question*, not the page it drew: a footer
        # reading "1–25 of 25" for a filtered set of four thousand is the
        # defect this exists to prevent.
        assert count_of(session, statement.limit(1)) == 2
        facets = facets_for(session, statement, spec)

    # Reachable from where the reader already is, rather than every value in
    # the table — BLOCKED is not offered because no row named "pop" has it.
    # Ordered by count, and ties are the database's business — so the *set*
    # is what this asserts.
    assert sorted(facets["status"], key=lambda one: one["value"]) == [
        {"value": "CLOSED", "count": 1},
        {"value": "OPEN", "count": 1},
    ]
