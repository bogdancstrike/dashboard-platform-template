"""Loading a spreadsheet somebody exported from something else (§29). — the record it leaves."""

from __future__ import annotations

from sqlalchemy import select

from src.core import vocabulary
from src.core.db import session_scope
from tests.imports_support import (  # noqa: F401
    IMPORTS,
    TARGET,
    _authenticate,
    _begin,
    _csv,
    _discard,
    _execute,
    _rows,
    pytestmark,
)


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
    from src.services.records import explorer

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
