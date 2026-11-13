"""`core.validation` and `core.cleaners`: the declarative payload checks."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from src.core import cleaners as c
from src.core.errors import ValidationError
from src.core.validation import Field, Schema

SCHEMA = Schema(
    [
        Field("name", c.bounded_name(maximum=5)),
        Field("note", c.text(3, empty=None), sparse=True),
        Field("size", c.choice(("S", "M"), default="M", error=c.not_a("size"))),
        Field("seen", c.flag, default=False, inherit=True),
        Field("probe", lambda raw, ctx: c.optional(c.text())(raw, ctx), always=True),
    ],
    not_object="Must be an object.",
    unknown="Unknown field.",
    unknown_lists_allowed=True,
)


def test_a_create_cleans_every_field_and_an_update_only_what_it_names():
    assert SCHEMA.validate({"name": " a  b ", "note": "long"}) == {
        "name": "a b", "note": "lon", "size": "M", "seen": False, "probe": None,
    }
    row = SimpleNamespace(seen=True)
    assert SCHEMA.validate({"size": "s"}, partial=True, existing=row) == {"size": "S"}
    assert SCHEMA.validate({"name": "x"}, existing=row)["seen"] is True


@pytest.mark.parametrize("payload, message", [
    ([], "Must be an object."),
    ({"name": "x", "colour": 1}, "Unknown field."),
    ({"name": ""}, "name must contain 1 to 5 characters"),
    ({"name": "x", "size": "XL"}, "That is not a size."),
])
def test_refusals_carry_the_callers_message(payload, message):
    with pytest.raises(ValidationError) as caught:
        SCHEMA.validate(payload)
    assert caught.value.message == message


def test_unknown_fields_can_list_what_is_allowed_and_a_non_object_can_read_as_empty():
    with pytest.raises(ValidationError) as caught:
        SCHEMA.validate({"zzz": 1})
    assert caught.value.details["allowed"] == ["name", "note", "probe", "seen", "size"]
    assert Schema([Field("a", c.flag)]).validate(None) == {"a": False}


def test_number_cleaners_parse_and_bound():
    assert c.whole("bad")("7") == 7 and c.number("bad")("2.5") == 2.5
    for parse in (c.whole("bad"), c.number("bad")):
        with pytest.raises(ValidationError):
            parse("x")
    assert c.within(1, 3, "out")(2) == 2
    with pytest.raises(ValidationError):
        c.within(1, 3, "out")(4)


def test_object_cleaners_and_named_errors():
    assert c.json_object("no")(None) == {} and c.object_or_null("no")(None) is None
    for clean in (c.json_object("no"), c.object_or_null("no")):
        with pytest.raises(ValidationError):
            clean([1])
    with pytest.raises(ValidationError) as caught:
        c.choice(("a",), case=str.lower, error=c.one_of_listed("kind"))("B")
    assert caught.value.details == {"field": "kind", "allowed": ["a"]}
    assert c.unknown_named("x")("v", ("a",)).message == "Unknown x."
    assert c.optional_uuid("id")("") is None
    assert c.text(required="needed", fallback="dflt")(None) == "dflt"
    with pytest.raises(ValidationError):
        c.fail("nope", field="x")
