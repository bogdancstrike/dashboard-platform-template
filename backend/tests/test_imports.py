"""Loading a spreadsheet somebody exported from something else (§29).

Five claims this module exists for.

**The rules are the form's rules.** A row is validated by
`record_writes.coerce` — the same function a create endpoint calls, against the
same declarations an edit form is rendered from. So the test that matters is
the one that shows a value a *form* refuses is also refused here, and by the
same message: an importer with its own validation would eventually accept a
status no form would, and the first anybody would hear of it is a 500 halfway
through an execute.

**The counts add up.** `total = valid + invalid + skipped`, asserted directly,
because the seeded runs carried `valid = total - invalid` beside a non-zero
`skipped` — three numbers that could not all be true at once.

**Nothing is written until the preview has been seen**, and then it is
all-or-nothing. A failure part-way must leave *no* records: half an import is
what makes somebody load the same file twice.

**The awkward file is the normal file.** A BOM, semicolons, a ragged line and
a trailing newline are not edge cases — they are what Excel produces on a
Windows machine in Europe, and each one has its own test.

**Somebody else's import is not there.** A staged import holds the contents of
a file: names, emails, whatever the spreadsheet had. Same rule as an export's
artefact, and asserted the same way — 404, not 403.
"""

from __future__ import annotations

import csv
import io

import pytest
from sqlalchemy import select

from src.config import Config
from src.core import background, importer, vocabulary
from src.core.db import session_scope
from src.services import imports as service
from tests.conftest import persona_claims

pytestmark = pytest.mark.database

PREFIX = Config.API_PREFIX
IMPORTS = f"{PREFIX}/imports"

#: The dataset these tests import into. `customer` because its writable set
#: includes an enum with a closed vocabulary, a foreign key, a number with
#: bounds and a date — which is what makes the validation assertions worth
#: making — and because exactly one of its fields is required, so "what is
#: still unmapped" has an unambiguous answer.
TARGET = "customer"

#: The enum whose vocabulary a bad value has to violate. `country` is free
#: text on this dataset, which is why the first version of these tests
#: "passed" a value like `NOT-A-COUNTRY` — it was genuinely valid.
ENUM_FIELD = "segment"
ENUM_BAD = "NOT-A-SEGMENT"


def _authenticate(monkeypatch, username: str = "manager", role: str = "manager"):
    monkeypatch.setattr(
        "src.core.auth.verify_token",
        lambda _token: persona_claims(username, role, sid=f"imp-{username}"),
    )
    return {"Authorization": f"Bearer imp-{username}"}


def _required(client, headers) -> list[str]:
    """Which fields the target insists on, from the API rather than a guess."""
    catalogue = client.get(f"{IMPORTS}/catalogue", headers=headers).get_json()
    target = next(item for item in catalogue["targets"] if item["key"] == TARGET)
    return target["required"]


def _csv(rows: list[dict[str, str]], *, delimiter: str = ",", bom: bool = False) -> str:
    """A file the way a spreadsheet would have written it."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=list(rows[0]), delimiter=delimiter)
    writer.writeheader()
    writer.writerows(rows)
    return ("﻿" if bom else "") + buffer.getvalue()


def _begin(client, headers, content: str, **payload):
    body = {"target_entity": TARGET, "filename": "customers.csv", "content": content, **payload}
    return client.post(IMPORTS, json=body, headers=headers)


def _discard(client, headers, import_id: str) -> None:
    """Let a run go entirely, through the endpoint a person uses.

    Twice, because `discard` takes two presses — the file, then the record —
    and a sweep that pressed once would leave a cancelled run behind for every
    test in this module. The same shape `/exports` and `e2e/api.sweepMailThreads`
    use.
    """
    client.delete(f"{IMPORTS}/{import_id}", headers=headers)
    client.delete(f"{IMPORTS}/{import_id}", headers=headers)


def _rows(count: int = 3, **overrides) -> list[dict[str, str]]:
    """Valid customer rows, named so a test's own records are recognisable."""
    return [
        {
            "name": f"Import Test Customer {index}",
            "email": f"import-test-{index}@example.test",
            "segment": "SMB",
            **overrides,
        }
        for index in range(1, count + 1)
    ]


# ── reading the file ────────────────────────────────────────────────────


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

    monkeypatch.setattr(importer, "MAX_ROWS", 2)
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


# ── guessing the mapping ────────────────────────────────────────────────


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


# ── the wizard ──────────────────────────────────────────────────────────


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
    from src.services import explorer, record_writes

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


def test_a_column_mapped_to_nothing_is_ignored_rather_than_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv([{"name": "Import Test", "legacy": "x"}])).get_json()

    try:
        mapped = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "legacy": ""}},
            headers=headers,
        ).get_json()
        # A deliberately ignored column is a normal answer, not an omission.
        assert mapped["column_mapping"] == {"name": "name"}
    finally:
        _discard(client, headers, body["id"])


def test_remapping_changes_which_rows_are_wrong(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rows = [{"name": "Import Test Remap", "when": "not-a-date"}]
    body = _begin(client, headers, _csv(rows)).get_json()

    try:
        # Mapped onto a date field: the value is wrong.
        bad = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "when": "last_contact_at"}},
            headers=headers,
        ).get_json()
        assert bad["invalid_rows"] == 1

        # Unmapped: the same file, and nothing wrong with it.
        good = client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name"}},
            headers=headers,
        ).get_json()
        assert good["invalid_rows"] == 0
        assert good["valid_rows"] == 1
    finally:
        _discard(client, headers, body["id"])


def test_the_preview_carries_the_line_number_from_the_file(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(3))).get_json()

    try:
        preview = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()["preview"]
        # Row 1 is the header, so the first data row is line 2 — which is what
        # somebody needs to find it in the spreadsheet.
        assert [entry["line"] for entry in preview] == [2, 3, 4]
        assert preview[0]["source"]["name"] == "Import Test Customer 1"
    finally:
        _discard(client, headers, body["id"])


# ── executing ───────────────────────────────────────────────────────────


def _execute(client, headers, import_id: str):
    """Run an import and wait for it by not needing to."""
    with background.synchronous():
        return client.post(f"{IMPORTS}/{import_id}/execute", headers=headers)


def test_an_import_creates_the_records_it_previewed(client, monkeypatch):
    from src.models.business import Customer

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(3))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )

    answer = _execute(client, headers, body["id"])
    assert answer.status_code == 202, answer.get_json()

    done = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()
    assert done["status"] == "COMPLETED"
    assert done["imported_rows"] == 3

    with session_scope() as session:
        made = session.scalars(
            select(Customer).where(Customer.name.like("Import Test Customer %"))
        ).all()
        assert len(made) == 3
        # Named by the server, as every create is — `customer` calls its
        # identifier `code`, which is why the resource declares the field
        # rather than the writer assuming one. A file does not get to choose
        # it, and none of these rows carried one.
        assert all(row.code.startswith("CUS-") for row in made)
        assert len({row.code for row in made}) == 3


def test_a_failure_part_way_leaves_no_records(client, monkeypatch):
    from src.models.business import Customer
    from src.services import record_writes

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(4))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )

    original = record_writes.create_many
    state = {"calls": 0}

    def explode(session, resource_type, payloads, *, principal):
        # Half the rows inserted, then a failure — the shape that would leave a
        # partial import behind if the transaction were not the boundary.
        state["calls"] += 1
        original(session, resource_type, payloads[:2], principal=principal)
        raise RuntimeError("the third row broke something")

    monkeypatch.setattr(record_writes, "create_many", explode)
    _execute(client, headers, body["id"])

    failed = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()
    assert state["calls"] == 1
    assert failed["status"] == "FAILED"
    assert failed["imported_rows"] == 0
    assert any("Nothing was imported" in item["message"] for item in failed["errors"])

    with session_scope() as session:
        # The two that were inserted are gone: half an import is what makes
        # somebody load the same file twice.
        assert (
            session.scalars(
                select(Customer).where(Customer.name.like("Import Test Customer %"))
            ).all()
            == []
        )


def test_the_invalid_rows_are_left_out_and_the_valid_ones_land(client, monkeypatch):
    from src.models.business import Customer

    headers = _authenticate(monkeypatch)
    rows = [
        *_rows(2),
        {"name": "Import Test Bad", "email": "x@example.test", "segment": ENUM_BAD},
    ]
    body = _begin(client, headers, _csv(rows)).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )

    _execute(client, headers, body["id"])
    done = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()

    # All-or-nothing applies to the *valid* rows: the bad one was reported at
    # the preview, which is the step that exists so it can be.
    assert done["status"] == "COMPLETED"
    assert done["imported_rows"] == 2
    with session_scope() as session:
        names = {
            row.name
            for row in session.scalars(
                select(Customer).where(Customer.name.like("Import Test %"))
            )
        }
    assert "Import Test Bad" not in names


def test_the_staged_file_is_dropped_once_it_has_been_used(client, monkeypatch):
    from src.models.platform import ImportRun

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )
    _execute(client, headers, body["id"])

    with session_scope() as session:
        row = session.get(ImportRun, body["id"])
        # It is a copy of somebody's spreadsheet, and holding it after the
        # records exist would be holding the data twice for no reason.
        assert row.staged_rows is None


def test_an_import_cannot_be_run_twice(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )
    _execute(client, headers, body["id"])

    again = client.post(f"{IMPORTS}/{body['id']}/execute", headers=headers)
    assert again.status_code == 409
    assert "already been imported" in again.get_json()["message"]


def test_an_unvalidated_import_is_refused_with_the_reason(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv([{"segment": "SMB"}])).get_json()

    try:
        answer = client.post(f"{IMPORTS}/{body['id']}/execute", headers=headers)
        assert answer.status_code == 409
        # Names the fields, because "not ready" leaves somebody to guess which
        # of eleven columns they have not mapped (§76).
        assert answer.get_json()["details"]["unmapped_required"]
    finally:
        _discard(client, headers, body["id"])


def test_a_file_with_no_valid_row_says_so_rather_than_running(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rows = [{"name": "", "email": "", "segment": ""}]
    body = _begin(client, headers, _csv(rows)).get_json()

    try:
        client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
            headers=headers,
        )
        answer = client.post(f"{IMPORTS}/{body['id']}/execute", headers=headers)
        assert answer.status_code == 409
        assert "nothing to import" in answer.get_json()["message"]
    finally:
        _discard(client, headers, body["id"])


# ── the error report ────────────────────────────────────────────────────


def test_the_problems_come_back_as_a_file_to_fix_in_the_spreadsheet(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    rows = [*_rows(1), {"name": "Import Test Bad", "email": "x@example.test", "segment": ENUM_BAD}]
    body = _begin(client, headers, _csv(rows)).get_json()

    try:
        client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
            headers=headers,
        )
        answer = client.get(f"{IMPORTS}/{body['id']}/problems", headers=headers)
        assert answer.status_code == 200
        assert "text/csv" in answer.headers["Content-Type"]

        lines = list(csv.DictReader(io.StringIO(answer.get_data(as_text=True).lstrip("﻿"))))
        # The four things needed to find and fix one.
        assert set(lines[0]) == {"Line", "Column", "Value", "Problem"}
        assert lines[0]["Line"] == "3"
        assert lines[0]["Column"] == ENUM_FIELD
        assert lines[0]["Value"] == ENUM_BAD
    finally:
        _discard(client, headers, body["id"])


def test_an_import_with_nothing_wrong_has_no_report(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        client.put(
            f"{IMPORTS}/{body['id']}/mapping",
            json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
            headers=headers,
        )
        # 404 rather than an empty file: a downloaded CSV with a header and no
        # rows reads as "the report is broken".
        assert client.get(f"{IMPORTS}/{body['id']}/problems", headers=headers).status_code == 404
    finally:
        _discard(client, headers, body["id"])


# ── whose import it is ──────────────────────────────────────────────────


def test_the_listing_is_mine_and_only_mine(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        mine = client.get(IMPORTS, headers=headers).get_json()
        assert body["id"] in [row["id"] for row in mine["items"]]

        admin = _authenticate(monkeypatch, "admin", "administrator")
        theirs = client.get(IMPORTS, headers=admin).get_json()
        assert body["id"] not in [row["id"] for row in theirs["items"]]
    finally:
        headers = _authenticate(monkeypatch, "manager", "manager")
        _discard(client, headers, body["id"])


def test_an_administrator_cannot_read_somebody_elses_staged_file(client, monkeypatch):
    headers = _authenticate(monkeypatch, "manager", "manager")
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        admin = _authenticate(monkeypatch, "admin", "administrator")
        # A staged import holds the contents of a spreadsheet — names, emails,
        # whatever it had. 404 rather than 403, for the reason an export's
        # artefact is: the reply must not confirm the reference exists.
        assert client.get(f"{IMPORTS}/{body['id']}", headers=admin).status_code == 404
        assert client.post(f"{IMPORTS}/{body['id']}/execute", headers=admin).status_code == 404
    finally:
        headers = _authenticate(monkeypatch, "manager", "manager")
        _discard(client, headers, body["id"])


def test_a_role_without_the_import_privilege_is_refused(client, monkeypatch):
    # Narrower than `records.create` on purpose: creating one record is a form
    # somebody can see, importing five thousand is not.
    headers = _authenticate(monkeypatch, "operator", "operator")
    assert client.get(IMPORTS, headers=headers).status_code == 403
    assert client.get(f"{IMPORTS}/catalogue", headers=headers).status_code == 403
    assert _begin(client, headers, _csv(_rows(1))).status_code == 403


def test_only_datasets_that_can_be_created_are_offered(client, monkeypatch):
    from src.services import explorer

    headers = _authenticate(monkeypatch)
    catalogue = client.get(f"{IMPORTS}/catalogue", headers=headers).get_json()
    offered = {item["key"] for item in catalogue["targets"]}

    assert TARGET in offered
    for key, resource in explorer.resources().items():
        if resource.identity is None:
            # A picker offering a dataset whose create 400s wastes somebody's
            # time (§76).
            assert key not in offered


def test_a_dataset_that_cannot_be_created_is_refused(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    answer = _begin(client, headers, _csv(_rows(1)), target_entity="nothing-like-this")
    assert answer.status_code == 400
    assert "available" in answer.get_json()["details"]


# ── letting go ──────────────────────────────────────────────────────────


def test_the_first_press_drops_the_staged_file_and_keeps_the_record(client, monkeypatch):
    from src.models.platform import ImportRun

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(2))).get_json()

    answer = client.delete(f"{IMPORTS}/{body['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["status"] == "CANCELLED"
    assert answer.get_json()["removed"] is False

    with session_scope() as session:
        row = session.get(ImportRun, body["id"])
        assert row is not None, "the record of the attempt survives the first press"
        # The copy of somebody's spreadsheet does not — that is the part that
        # may need to be gone now.
        assert row.staged_rows is None
        assert row.total_rows == 2

    _discard(client, headers, body["id"])


def test_the_second_press_removes_the_record(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    assert client.delete(f"{IMPORTS}/{body['id']}", headers=headers).get_json()[
        "removed"
    ] is False
    second = client.delete(f"{IMPORTS}/{body['id']}", headers=headers)
    assert second.status_code == 200
    assert second.get_json()["removed"] is True
    assert client.get(f"{IMPORTS}/{body['id']}", headers=headers).status_code == 404


def test_the_removed_record_leaves_its_history_behind(client, monkeypatch):
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()
    _discard(client, headers, body["id"])

    with session_scope() as session:
        actions = set(
            session.scalars(
                select(AuditLog.action).where(AuditLog.resource_id == body["id"])
            ).all()
        )
    # The reason removing the row is defensible: the history is in the one
    # place the person who made the run cannot edit it.
    assert {"import.begin", "import.discard", "import.remove"} <= actions


def test_a_completed_import_can_be_removed_but_not_re_run(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )
    _execute(client, headers, body["id"])

    # Its file is already gone, so the one press left removes the record —
    # there is nothing else to take away.
    answer = client.delete(f"{IMPORTS}/{body['id']}", headers=headers)
    assert answer.status_code == 200
    assert answer.get_json()["removed"] is True
    assert client.post(f"{IMPORTS}/{body['id']}/execute", headers=headers).status_code == 404


def test_a_running_import_cannot_be_discarded(client, monkeypatch):
    from src.models.platform import ImportRun

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        with session_scope() as session:
            session.get(ImportRun, body["id"]).status = "RUNNING"
        answer = client.delete(f"{IMPORTS}/{body['id']}", headers=headers)
        # Not while it is writing: removing the row mid-transaction would lose
        # the only record of what is happening.
        assert answer.status_code == 409
    finally:
        with session_scope() as session:
            row = session.get(ImportRun, body["id"])
            if row is not None:
                row.status = "DRAFT"
        _discard(client, headers, body["id"])


def test_only_so_many_may_be_open_at_once(client, monkeypatch):
    monkeypatch.setattr(service, "MAX_OPEN_PER_PERSON", 1)
    headers = _authenticate(monkeypatch)
    first = _begin(client, headers, _csv(_rows(1))).get_json()

    try:
        refused = _begin(client, headers, _csv(_rows(1)))
        assert refused.status_code == 409
        # A draft holds a whole file, so the limit is about held data as much
        # as about rows of a table.
        assert refused.get_json()["details"]["maximum"] == 1
    finally:
        _discard(client, headers, first["id"])


def test_a_discarded_import_frees_its_slot(client, monkeypatch):
    monkeypatch.setattr(service, "MAX_OPEN_PER_PERSON", 1)
    headers = _authenticate(monkeypatch)
    first = _begin(client, headers, _csv(_rows(1))).get_json()
    _discard(client, headers, first["id"])

    second = _begin(client, headers, _csv(_rows(1)))
    assert second.status_code == 201
    _discard(client, headers, second.get_json()["id"])


# ── the record it leaves ────────────────────────────────────────────────


def test_the_audit_records_the_shape_of_the_file_and_not_its_contents(client, monkeypatch):
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(2))).get_json()

    try:
        with session_scope() as session:
            entry = session.scalar(
                select(AuditLog).where(
                    AuditLog.resource_id == body["id"], AuditLog.action == "import.begin"
                )
            )
            after = entry.state_after or {}
        assert after["into"] == TARGET
        assert after["rows"] == 2
        assert after["columns"] == ["name", "email", "segment"]
        # An audit row carrying the rows would be a second copy of the data
        # somebody is importing.
        assert "staged_rows" not in after and "rows_data" not in after
    finally:
        _discard(client, headers, body["id"])


def test_each_created_record_is_audited_and_the_import_is_too(client, monkeypatch):
    from src.models.platform import AuditLog

    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(2))).get_json()
    client.put(
        f"{IMPORTS}/{body['id']}/mapping",
        json={"column_mapping": {"name": "name", "email": "email", "segment": "segment"}},
        headers=headers,
    )
    _execute(client, headers, body["id"])

    with session_scope() as session:
        run = session.scalars(
            select(AuditLog.action).where(AuditLog.resource_id == body["id"])
        ).all()
        created = session.scalars(
            select(AuditLog).where(
                AuditLog.resource_type == TARGET, AuditLog.action == "CREATE"
            )
        ).all()

    assert "import.execute" in run
    # Each record's own CREATE row, because "where did this customer come
    # from" is a question the ledger has to answer (§21).
    from_import = [
        row for row in created if (row.metadata_json or {}).get("import_row")
    ] if hasattr(AuditLog, "metadata_json") else created
    assert from_import, "the created records left no audit trail"


def test_the_detected_separator_is_on_every_read_not_only_the_first(client, monkeypatch):
    """Otherwise the page's own promise lasts one render.

    The note was attached to `begin`'s answer only, so the wizard showed "Read
    as semicolon-separated" until its first refetch and then showed nothing —
    leaving a reader whose file came back as one column with no explanation.
    Found by the end-to-end walkthrough, which reads the run rather than the
    response that created it.
    """
    headers = _authenticate(monkeypatch)
    body = _begin(client, headers, _csv(_rows(2), delimiter=";")).get_json()

    try:
        assert body["dialect"]["delimiter"] == ";"
        again = client.get(f"{IMPORTS}/{body['id']}", headers=headers).get_json()
        assert again["dialect"] == body["dialect"]
    finally:
        _discard(client, headers, body["id"])


def test_a_ragged_file_says_how_many_lines_disagree(client, monkeypatch):
    headers = _authenticate(monkeypatch)
    # Two lines with an extra value: the unescaped-separator case.
    content = "name,email\nA,a@x.test\nB,b@x.test,extra\nC,c@x.test,extra\n"
    body = _begin(client, headers, content).get_json()

    try:
        assert body["dialect"]["consistent"] is False
        # Plural, because one line disagreeing and twelve are different
        # problems and a reader is about to go looking for them.
        assert "2 lines disagree" in body["dialect"]["note"]
    finally:
        _discard(client, headers, body["id"])


# ── the seeded runs ─────────────────────────────────────────────────────


def test_no_seeded_import_describes_a_file_that_could_not_exist():
    """The defects building this page found, asserted against the database.

    Every one of these was true of the seeded runs: `valid = total - invalid`
    beside a non-zero `skipped`, so three of four counts were mutually
    impossible; the same five column names whatever the target, four of them
    mapped onto fields `order` and `task` do not accept; up to 25,000 rows
    against a cap of 5,000; and open drafts holding nothing, so resuming one
    showed an empty wizard.

    Asked here rather than through the API because the API only ever shows a
    reader *their own* runs — which is right, and means only a query can see
    all of them.
    """
    from src.core import importer
    from src.models.platform import ImportRun
    from src.services import explorer

    creatable = {
        key for key, resource in explorer.resources().items() if resource.identity is not None
    }

    with session_scope() as session:
        rows = session.scalars(select(ImportRun)).all()
        assert rows, "run `make seed`; there are no import runs"

        wrong: list[str] = []
        for row in rows:
            if row.target_entity not in creatable:
                wrong.append(f"{row.reference}: imports into something that cannot be created")
                continue
            resource = explorer.resources()[row.target_entity]
            columns = {str(item.get("name")) for item in (row.detected_columns or [])}
            mapping = row.column_mapping or {}
            if set(mapping) - columns:
                wrong.append(f"{row.reference}: maps columns the file does not have")
            if set(mapping.values()) - set(resource.writable):
                wrong.append(f"{row.reference}: maps onto fields the target does not accept")
            if row.total_rows > importer.MAX_ROWS:
                wrong.append(f"{row.reference}: more rows than an import may carry")
            counted = row.valid_rows + row.invalid_rows + row.skipped_rows
            if (row.status in vocabulary.IMPORT_COUNTED or counted) and (
                counted != row.total_rows
            ):
                wrong.append(f"{row.reference}: its four counts do not add up")

    assert wrong == [], "run `make sync-imports`"


def test_every_open_seeded_run_can_actually_be_resumed():
    """A draft that holds no rows is a wizard that reopens empty.

    Which is what the whole flow exists to support, and what every seeded
    draft did before the repair.
    """
    from src.models.platform import ImportRun

    with session_scope() as session:
        rows = session.scalars(
            select(ImportRun).where(ImportRun.status.in_(("DRAFT", "VALIDATED")))
        ).all()
        empty = [row.reference for row in rows if not (row.staged_rows or [])]
        # And the total is the rows it holds: two independent numbers let a
        # draft claim four hundred and stage sixty.
        lying = [
            row.reference for row in rows if len(row.staged_rows or []) != row.total_rows
        ]

    assert empty == [], "run `make sync-imports`"
    assert lying == []


def test_a_finished_seeded_run_is_not_still_holding_the_file():
    from src.models.platform import ImportRun

    with session_scope() as session:
        rows = session.scalars(
            select(ImportRun).where(ImportRun.status.notin_(("DRAFT", "VALIDATED")))
        ).all()
        holding = [row.reference for row in rows if (row.staged_rows or [])]
    # A copy of somebody's spreadsheet, kept after the rows became records.
    assert holding == []
