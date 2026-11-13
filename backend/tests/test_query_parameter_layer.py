"""`core/query.py` — one test per operator per field kind, and the subtle ones. — the parameter layer."""

from __future__ import annotations

import pytest
from sqlalchemy import (
    select,
)

from src.core.pagination import Page
from src.core.query import (
    apply_filters,
    apply_sort,
    count_of,
    facets_for,
)
from tests.query_support import (  # noqa: F401
    filtered,
    probe,
    spec,
)


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
