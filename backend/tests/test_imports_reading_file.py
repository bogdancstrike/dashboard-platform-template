"""Loading a spreadsheet somebody exported from something else (§29). — reading the file."""

from __future__ import annotations

import pytest

from src.core import importer
from src.core.db import session_scope
from tests.imports_support import (  # noqa: F401
    ENUM_BAD,
    ENUM_FIELD,
    IMPORTS,
    _authenticate,
    _begin,
    _csv,
    _discard,
    _required,
    _rows,
    pytestmark,
)
from tests.patching import patch_package


def test_the_separator_is_found_rather_than_assumed():
    # Excel follows the locale, so half the spreadsheets in Europe are
    # semicolon-separated. A parser that assumed a comma would read one of
    # those as a single column whose name is the whole header line.
    sheet = importer.read("code;name;country\nC-1;Ada;RO\n")
    assert sheet.dialect.delimiter == ";"
    assert sheet.dialect.consistent is True
    assert [column.name for column in sheet.columns] == ["code", "name", "country"]


def test_a_comma_inside_a_value_does_not_win_the_vote():
    # The comma is the most *frequent* character on this line and the wrong
    # answer: consistency is what identifies the separator, not frequency.
    text = 'name;notes\nAda;"one, two, three"\nOtto;"four, five, six"\n'
    assert importer.sniff(text).delimiter == ";"


def test_a_byte_order_mark_is_not_part_of_the_first_column_name():
    # Excel writes one. Without this the first header is `﻿code`, matches
    # nothing, and presents as "the first column cannot be mapped" on every
    # file a Windows user produces.
    sheet = importer.read("﻿code,name\nC-1,Ada\n")
    assert sheet.columns[0].name == "code"


def test_a_trailing_newline_is_not_a_row_of_empty_fields():
    sheet = importer.read("code,name\nC-1,Ada\n\n")
    assert sheet.total == 1
    assert sheet.blank == 1


def test_a_ragged_line_is_reported_and_the_import_carries_on():
    # An unescaped separator inside a description is the usual cause, and
    # aborting the file means nobody finds out which line it was.
    sheet = importer.read("code,name\nC-1,Ada\nC-2,Otto,extra\nC-3,Ilse\n")
    assert sheet.total == 3
    assert [problem["line"] for problem in sheet.ragged] == [3]
    assert "3 values where the header has 2" in sheet.ragged[0]["message"]


def test_a_short_line_is_padded_rather_than_dropped():
    sheet = importer.read("code,name,country\nC-1,Ada\n")
    assert sheet.rows == [{"code": "C-1", "name": "Ada", "country": ""}]


def test_two_columns_with_one_name_stay_addressable():
    sheet = importer.read("name,name\nAda,Lovelace\n")
    assert [column.name for column in sheet.columns] == ["name", "name (2)"]


def test_an_unnamed_column_is_still_selectable():
    sheet = importer.read("code,,country\nC-1,x,RO\n")
    assert [column.name for column in sheet.columns] == ["code", "Column 2", "country"]


def test_a_column_carries_samples_so_two_can_be_told_apart():
    sheet = importer.read("a,b\nfirst,1\nsecond,2\nthird,3\nfourth,4\n")
    # Three, because a person needs enough to recognise the column and not a
    # copy of it.
    assert sheet.columns[0].samples == ("first", "second", "third")


def test_a_file_over_the_row_cap_is_refused_with_the_number(monkeypatch):
    from src.core.errors import ValidationError

    patch_package(monkeypatch, importer, "MAX_ROWS", 2)
    text = "code\n" + "".join(f"C-{index}\n" for index in range(5))
    with pytest.raises(ValidationError) as refusal:
        importer.read(text)
    # Refused before anything is staged: accepting it and failing at the
    # execute would have cost somebody the mapping step for nothing.
    assert refusal.value.details["maximum"] == 2


def test_an_empty_file_says_so():
    from src.core.errors import ValidationError

    with pytest.raises(ValidationError, match="no rows"):
        importer.read("\n\n")


def test_a_column_name_matches_a_field_however_it_is_spelled():
    columns = importer.read("Account Manager,DUE-DATE,e mail\nx,y,z\n").columns
    mapping = importer.suggest(
        columns,
        {"account_manager_id": "Account manager", "due_date": "Due date", "email": "Email"},
    )
    # Normalised on both sides, and a foreign key's `_id` suffix is not
    # something the file's author had any reason to write.
    assert mapping == {
        "Account Manager": "account_manager_id",
        "DUE-DATE": "due_date",
        "e mail": "email",
    }


def test_a_field_is_only_suggested_once():
    columns = importer.read("email,e-mail\na,b\n").columns
    mapping = importer.suggest(columns, {"email": "Email"})
    # Two columns onto one field would make the second silently win, which is
    # the kind of thing nobody sees until the records are wrong.
    assert list(mapping.values()) == ["email"]


def test_a_column_that_matches_nothing_is_left_unmapped():
    columns = importer.read("legacy_ref,name\nx,y\n").columns
    mapping = importer.suggest(columns, {"name": "Name"})
    assert "legacy_ref" not in mapping


def test_a_file_is_read_and_a_mapping_proposed(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    response = _begin(client, headers, _csv(_rows()))
    assert response.status_code == 201, response.get_json()
    body = response.get_json()

    try:
        assert body["reference"].startswith("IMP-")
        assert body["status"] == "DRAFT"
        assert body["step"] == "MAPPING"
        assert body["total_rows"] == 3
        assert [column["name"] for column in body["detected_columns"]] == [
            "name",
            "email",
            "segment",
        ]
        # Proposed, not applied: the mapping step exists because the guess is
        # sometimes wrong.
        assert body["column_mapping"] == {"name": "name", "email": "email", "segment": "segment"}
        assert body["dialect"]["label"] == "comma"
        assert body["dialect"]["consistent"] is True
    finally:
        _discard(client, headers, body["id"])


def test_a_semicolon_file_is_read_without_being_told(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(), delimiter=";", bom=True)).get_json()
    try:
        assert body["delimiter"] == ";"
        assert body["total_rows"] == 3
        # And the BOM did not become part of the first column's name, which is
        # what would have made it unmappable.
        assert body["detected_columns"][0]["name"] == "name"
    finally:
        _discard(client, headers, body["id"])


def test_a_delimiter_can_be_overridden_when_the_guess_is_wrong(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    # A single-column file whose one value contains a comma: read as CSV it is
    # two columns, which is exactly the case somebody has to override.
    body = _begin(
        client, headers, 'name\n"Ada, Countess"\n', delimiter="|"
    ).get_json()
    try:
        assert body["delimiter"] == "|"
        assert [column["name"] for column in body["detected_columns"]] == ["name"]
    finally:
        _discard(client, headers, body["id"])


def test_the_wizard_says_which_required_fields_have_no_column(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    required = _required(client, headers)
    assert required, "the target declares no required fields, so this proves nothing"

    body = _begin(client, headers, _csv([{"segment": "SMB"}])).get_json()
    try:
        # Derived from the mapping rather than stored, so it changes when the
        # mapping does — and the execute is refused while it is non-empty.
        assert set(body["unmapped_required"]) == set(required)
        assert body["can_execute"] is False
    finally:
        _discard(client, headers, body["id"])


def test_mapping_validates_in_the_same_call(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows())).get_json()

    try:
        answer = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
            headers=headers,
        )
        assert answer.status_code == 200, answer.get_json()
        mapped = answer.get_json()

        # One call, because a mapping change changes which rows are wrong: a
        # separate Validate press would be a step whose answer is known.
        assert mapped["status"] == "VALIDATED"
        assert mapped["step"] == "PREVIEW"
        assert mapped["valid_rows"] == 3
        assert mapped["can_execute"] is True
    finally:
        _discard(client, headers, body["id"])


def test_the_counts_add_up(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rows = [
        {"name": "Import Test Customer 1", "email": "a@example.test",
         "segment": "SMB", "legacy": ""},
        {"name": "Import Test Customer 2", "email": "b@example.test",
         "segment": "SMB", "legacy": ""},
        # Wrong: an enum value the dataset's own vocabulary does not have.
        {"name": "Import Test Bad", "email": "bad@example.test",
         "segment": ENUM_BAD, "legacy": ""},
        # Nothing in any *mapped* column, but not an empty line — a wholly
        # blank line never reaches this step, because `importer.read` drops it
        # as a trailing newline. This is the case "skipped" is actually for:
        # a row carrying only data nobody mapped.
        {"name": "", "email": "", "segment": "", "legacy": "L-9"},
    ]
    body = _begin(client, headers, _csv(rows)).get_json()

    try:
        mapped = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={
                "column_mapping": {
                    "name": "name",
                    "email": "email",
                    "segment": "segment",
                    "legacy": "",
                }
            },
            headers=headers,
        ).get_json()

        # The claim, stated as arithmetic. The seeded runs carried
        # `valid = total - invalid` beside a non-zero `skipped`, which made
        # three of the four numbers mutually impossible.
        assert (
            mapped["valid_rows"] + mapped["invalid_rows"] + mapped["skipped_rows"]
            == mapped["total_rows"]
        )
        assert mapped["skipped_rows"] == 1
    finally:
        _discard(client, headers, body["id"])


def test_a_row_is_refused_by_the_rule_a_form_uses(client, monkeypatch):
    from src.services.records import explorer
    from src.services.records import writes as record_writes

    headers = _authenticate(monkeypatch)
    rows = [{"name": "Import Test Enum", "email": "e@example.test", "segment": ENUM_BAD}]
    body = _begin(client, headers, _csv(rows)).get_json()

    try:
        mapped = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "email": "email", "segment": ENUM_FIELD}},
            headers=headers,
        ).get_json()

        problem = next(item for item in mapped["errors"] if item["field"] == ENUM_FIELD)
        # The *same message* a form would give, because it is the same
        # function. An importer with its own rules would drift from this and
        # nobody would know until an execute failed.
        with session_scope() as session:
            resource = explorer.resources()["customer"]
            _, expected = record_writes.coerce(
                session, resource, {ENUM_FIELD: ENUM_BAD}, creating=False
            )
        assert problem["message"] == expected[0]["message"]
        # And the value as written, so the report reads beside the spreadsheet.
        assert problem["value"] == ENUM_BAD
        assert problem["line"] == 2
    finally:
        _discard(client, headers, body["id"])


def test_two_columns_onto_one_field_is_refused_with_both_named(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv([{"a": "x", "b": "y"}])).get_json()

    try:
        answer = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"a": "name", "b": "name"}},
            headers=headers,
        )
        assert answer.status_code == 400
        # The quiet one: the second column would silently win.
        assert set(answer.get_json()["details"]["columns"]) == {"a", "b"}
    finally:
        _discard(client, headers, body["id"])


def test_a_column_that_is_not_in_the_file_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        answer = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"nonexistent": "name"}},
            headers=headers,
        )
        assert answer.status_code == 400
        assert answer.get_json()["details"]["columns"] == ["nonexistent"]
    finally:
        _discard(client, headers, body["id"])


def test_a_field_the_dataset_does_not_accept_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv([{"a": "x"}])).get_json()

    try:
        answer = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"a": "id"}},
            headers=headers,
        )
        assert answer.status_code == 400
        assert "editable" in answer.get_json()["details"]
    finally:
        _discard(client, headers, body["id"])
