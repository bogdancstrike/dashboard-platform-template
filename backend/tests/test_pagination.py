"""`core/pagination.py` — the page envelope and the two refusals (§52).

Forty-two endpoints call `parse_page`, and the module had no tests: it was
covered incidentally, through whichever endpoint a test happened to page. What
that leaves unasserted is the *refusals* — a page size of 10 000, a `sort` a
client invented, a UUID that is not one — and every one of those is a 400 the
client can act on or a 500 nobody can.

The envelope's arithmetic is here too, because "pages" is the number a footer
renders and an off-by-one there is visible on every list in the product.
"""

from __future__ import annotations

import pytest

from src.core.errors import ValidationError
from src.core.pagination import (
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    PAGE_SIZE_CHOICES,
    Page,
    envelope,
    parse_page,
    parse_uuid,
)


def test_the_defaults_are_the_ones_a_list_endpoint_wants():
    page = parse_page({}, default_sort="created_at")
    assert (page.page, page.page_size, page.sort, page.order) == (
        1,
        DEFAULT_PAGE_SIZE,
        "created_at",
        "desc",
    )
    # Newest first, because a list of records is read from the top and the
    # newest is what changed since the reader last looked.
    assert parse_page({}, default_sort="name", default_order="asc").order == "asc"


def test_the_offset_is_derived_rather_than_sent():
    # A client that sends its own offset alongside a page number is a client
    # that can disagree with itself.
    assert Page(page=1, page_size=25, sort="id", order="asc").offset == 0
    assert Page(page=4, page_size=25, sort="id", order="asc").offset == 75


def test_a_page_below_one_is_the_first_page():
    # `?page=0` and `?page=-3` come from arithmetic in a client, not from a
    # person. Clamped rather than refused: there is exactly one sensible
    # answer and refusing it helps nobody.
    assert parse_page({"page": "0"}, default_sort="id").page == 1
    assert parse_page({"page": "-3"}, default_sort="id").page == 1


@pytest.mark.parametrize("size", ["0", "-1", str(MAX_PAGE_SIZE + 1), "100000"])
def test_a_page_size_outside_the_range_is_refused_with_the_range(size):
    # Not clamped, unlike the page number: a client asking for 100 000 rows is
    # asking for something it will not get, and silently giving it 200 while
    # its own footer says otherwise is worse than saying no.
    with pytest.raises(ValidationError) as raised:
        parse_page({"page_size": size}, default_sort="id")
    assert str(MAX_PAGE_SIZE) in str(raised.value)


@pytest.mark.parametrize("value", ["two", "", "1.5", None])
def test_a_page_that_is_not_a_number_is_a_400_not_a_500(value):
    with pytest.raises(ValidationError):
        parse_page({"page": value, "page_size": value}, default_sort="id")


def test_an_order_that_is_not_a_direction_is_refused():
    with pytest.raises(ValidationError) as raised:
        parse_page({"order": "sideways"}, default_sort="id")
    assert "asc" in str(raised.value)
    # Case is the client's business, not the server's.
    assert parse_page({"order": "ASC"}, default_sort="id").order == "asc"


def test_an_empty_sort_or_order_falls_back_rather_than_failing():
    # A form that submits every field sends `sort=`; the URL a person pasted
    # is not a reason to refuse the page.
    page = parse_page({"sort": "", "order": ""}, default_sort="created_at")
    assert (page.sort, page.order) == ("created_at", "desc")


def test_the_sort_is_taken_at_face_value_here_and_checked_by_the_field_set():
    """`parse_page` does not know the columns; `apply_sort` does.

    Deliberate: the page is parsed before the endpoint's `FieldSet` is in
    scope, and `FieldSet.sort_column` falls back to the default for a name it
    does not have — so a stale bookmark sorts by something sensible instead of
    getting a 400 (asserted in `test_query.py`).
    """
    assert parse_page({"sort": "nonsense"}, default_sort="id").sort == "nonsense"


def test_the_envelope_carries_what_a_footer_needs_to_say():
    body = envelope([1, 2, 3], total=53, page=Page(page=2, page_size=25, sort="id", order="asc"))
    assert body["items"] == [1, 2, 3]
    assert body["total"] == 53
    assert body["page"] == 2
    assert body["page_size"] == 25
    # 53 rows in pages of 25 is three pages, and the third holds three rows.
    assert body["pages"] == 3
    assert body["sort"] == "id"
    assert body["order"] == "asc"


def test_an_empty_result_is_one_page_and_not_zero():
    # A pager rendering "page 1 of 0" is a pager nobody wrote a state for.
    body = envelope([], total=0, page=Page(page=1, page_size=25, sort="id", order="desc"))
    assert body["pages"] == 1
    assert body["total"] == 0


def test_an_exact_multiple_does_not_gain_an_empty_last_page():
    body = envelope([], total=50, page=Page(page=1, page_size=25, sort="id", order="desc"))
    assert body["pages"] == 2


def test_extras_ride_along_without_a_second_envelope():
    # Facets, a condition sentence, a matched count: every list adds something,
    # and each one inventing its own wrapper is how two endpoints end up with
    # `total` in different places.
    body = envelope([], total=0, page=Page(page=1, page_size=10, sort="id", order="desc"), facets={"status": []})
    assert body["facets"] == {"status": []}


def test_the_page_sizes_a_saved_view_may_carry_are_within_the_cap():
    # `services/saved_searches` validates against this tuple, and a choice
    # above `MAX_PAGE_SIZE` would be a saved view that cannot be run.
    assert set(PAGE_SIZE_CHOICES) <= set(range(1, MAX_PAGE_SIZE + 1))
    assert DEFAULT_PAGE_SIZE in PAGE_SIZE_CHOICES


def test_a_path_that_is_not_a_uuid_is_a_400_naming_the_field():
    """An arbitrary string in a UUID comparison is a 500 from PostgreSQL.

    `invalid input syntax for type uuid` is what the database says, and it
    surfaces as a server error for what is plainly a client one — which also
    means the correlation id points a reader at nothing they can fix.
    """
    with pytest.raises(ValidationError) as raised:
        parse_uuid("not-a-uuid", field="search_id")
    assert raised.value.details == {"search_id": "not-a-uuid"}
    assert "search_id" in str(raised.value)

    for value in (None, "", "1", "11111111-1111-1111-1111-11111111111"):
        with pytest.raises(ValidationError):
            parse_uuid(value, field="id")


def test_a_uuid_comes_back_as_one_however_it_was_written():
    from uuid import UUID

    wanted = UUID("11111111-1111-1111-1111-111111111111")
    assert parse_uuid("11111111-1111-1111-1111-111111111111") == wanted
    # Braced and unhyphenated spellings are the same identifier, and a link
    # somebody hand-assembled is not a reason to refuse the record.
    assert parse_uuid("11111111111111111111111111111111") == wanted
    assert parse_uuid("{11111111-1111-1111-1111-111111111111}") == wanted
