"""Undo what a test did to the shared database — and only that.

How it works and why: docs/testing/backend.md ("undoes exactly what it did").
"""

from __future__ import annotations

import json
import re
from typing import Any


class Window:
    """What one test (or the time between tests) changed."""

    def __init__(self) -> None:
        #: (table, key as text) → (Table, key as bound) — rows we inserted.
        self.inserted: dict[tuple[str, tuple], tuple[Any, tuple]] = {}
        #: (table, key as text) → the row as JSON, the first time we saw it.
        self.original: dict[tuple[str, tuple], str] = {}
        #: Keys this window deleted: re-inserting one is a restore, not ours.
        self.deleted: set[tuple[str, tuple]] = set()

    def __bool__(self) -> bool:
        return bool(self.inserted or self.original)


class UndoLog:
    def __init__(self) -> None:
        #: Session totals, for the line the run ends with.
        self.swept = self.restored = 0
        self.leftovers: list[str] = []
        self.active = False
        self.url = None
        self.metadata = None
        self.outside = Window()
        self.current = self.outside

    # ── lifecycle ──────────────────────────────────────────────────────

    def begin_session(self, url, metadata) -> None:
        self.url, self.metadata, self.active = url, metadata, True

    def start(self) -> None:
        self.current = Window()

    def stop(self) -> Window:
        window, self.current = self.current, self.outside
        return window

    # ── recording ──────────────────────────────────────────────────────

    def before(self, conn, cursor, statement, parameters, context, executemany):  # noqa: ARG002
        """`before_cursor_execute`: keep the rows an UPDATE/DELETE will change."""
        if not self.active or not _same_database(conn.engine.url, self.url):
            return
        head = statement.lstrip()[:7].upper()
        if head.startswith("UPDATE"):
            kind = "UPDATE"
        elif head.startswith("DELETE"):
            kind = "DELETE"
        else:
            return
        query = _select_for(statement, kind)
        if query is None:
            return
        table_name, sql = query
        table = self.metadata.tables.get(table_name.strip('"'))
        if table is None or not table.primary_key.columns:
            return
        batches = parameters if executemany else [parameters]
        raw = conn.connection.dbapi_connection
        try:
            with raw.cursor() as reader:
                reader.execute("SAVEPOINT nx_undo")
                try:
                    for params in batches:
                        reader.execute(sql, params if params is not None else {})
                        rows = [r[0] for r in reader.fetchall()]
                        self._keep(table, rows)
                        if kind == "DELETE":
                            self._keep_dependants(reader, table, rows)
                    reader.execute("RELEASE SAVEPOINT nx_undo")
                except Exception:  # noqa: BLE001 - a capture never breaks the statement
                    reader.execute("ROLLBACK TO SAVEPOINT nx_undo")
        except Exception:  # noqa: BLE001 - e.g. no transaction block (autocommit)
            return

    def after(self, conn, cursor, statement, parameters, context, executemany):  # noqa: ARG002
        """`after_cursor_execute`: remember the keys a successful INSERT wrote."""
        if not self.active or context is None or getattr(context, "compiled", None) is None:
            return
        if not (context.isinsert or context.isdelete):
            return
        table = getattr(context.compiled.statement, "table", None)
        if table is None or not hasattr(table, "primary_key"):
            return
        if not _same_database(conn.engine.url, self.url):
            return
        window = self.current
        for params in context.compiled_parameters or ():
            bound = _bound_key(table, params)
            if bound is None:
                continue
            entry = (table.name, tuple(str(v) for v in bound))
            if context.isinsert:
                if entry not in window.deleted:
                    window.inserted[entry] = (table, bound)
            else:
                window.deleted.add(entry)
                window.inserted.pop(entry, None)

    def _keep(self, table, rows: list[str]) -> None:
        window = self.current
        names = [c.name for c in table.primary_key.columns]
        for text in rows:
            row = json.loads(text)
            entry = (table.name, tuple(str(row.get(n)) for n in names))
            if entry in window.inserted or entry in window.original:
                continue
            window.original[entry] = text

    def _keep_dependants(self, reader, table, rows: list[str], depth: int = 0) -> None:
        """The rows a foreign key will cascade to or null when these go."""
        if not rows or depth > 4:
            return
        parsed = [json.loads(text) for text in rows]
        for child in self.metadata.tables.values():
            for fk in child.foreign_key_constraints:
                if fk.referred_table is not table or (fk.ondelete or "").upper() not in ("CASCADE", "SET NULL"):
                    continue
                if len(fk.columns) != 1:
                    continue
                column = next(iter(fk.columns)).name
                referred = fk.elements[0].column.name
                values = sorted({str(r[referred]) for r in parsed if r.get(referred) is not None})
                if not values:
                    continue
                reader.execute(
                    f'SELECT row_to_json("{child.name}".*)::text FROM "{child.name}" '
                    f'WHERE "{column}"::text = ANY(%(v)s)',
                    {"v": values},
                )
                found = [r[0] for r in reader.fetchall()]
                self._keep(child, found)
                if (fk.ondelete or "").upper() == "CASCADE" and child is not table:
                    self._keep_dependants(reader, child, found, depth + 1)

    # ── undoing ────────────────────────────────────────────────────────

    def undo(self, engine, window: Window) -> list[str]:
        """Delete what the window inserted, then put back what it changed.

        Recording is paused meanwhile: the undo's own statements are not part
        of anybody's window.
        """
        active, self.active = self.active, False
        try:
            refused = sweep(engine, window.inserted)
            written: list[int] = []
            if window.original:
                refused += restore(engine, window.original, self.metadata, written)
            recount_tags(engine)
            self.swept += len(window.inserted)
            self.restored += sum(written)
            self.leftovers += refused
        finally:
            self.active = active
        return refused


LOG = UndoLog()


# ── helpers ──────────────────────────────────────────────────────────────


def _same_database(url_a, url_b) -> bool:
    if url_a is None or url_b is None:
        return False
    return (url_a.host, url_a.port, url_a.database) == (url_b.host, url_b.port, url_b.database)


def _bound_key(table, params) -> tuple | None:
    columns = list(table.primary_key.columns)
    if not columns or not isinstance(params, dict):
        return None
    try:
        return tuple(params[column.key] for column in columns)
    except KeyError:
        return None


def _top_level(sql: str, word: str, start: int = 0) -> int:
    """Index of ` word ` outside parentheses and quotes, or -1."""
    depth, quote, i, needle, n = 0, None, start, f" {word} ", len(sql)
    upper = sql.upper()
    while i < n:
        ch = sql[i]
        if quote:
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote = ch
        elif ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif depth == 0 and upper.startswith(needle, i):
            return i
        i += 1
    return -1


_DELETE = re.compile(r"^\s*DELETE\s+FROM\s+(\"[^\"]+\"|[\w.]+)", re.I | re.S)
_UPDATE = re.compile(r"^\s*UPDATE\s+(\"[^\"]+\"|[\w.]+)\s+SET\s", re.I | re.S)


def _select_for(statement: str, kind: str) -> tuple[str, str] | None:
    """`SELECT row_to_json(t.*)` over the rows an UPDATE/DELETE will touch."""
    sql = " ".join(statement.split())
    match = (_DELETE if kind == "DELETE" else _UPDATE).match(sql)
    if not match or ";" in sql:
        return None
    table = match.group(1)
    where = _top_level(sql, "WHERE", match.end() - 1)
    tail = sql[where + 7:] if where >= 0 else ""
    returning = _top_level(" " + tail, "RETURNING")
    if returning >= 0:
        tail = tail[: returning - 1]
    if kind == "DELETE":
        middle = sql[match.end():where if where >= 0 else len(sql)]
        using = _top_level(middle + " ", "USING")
        sources = table + ((", " + middle[using + 7:].strip()) if using >= 0 else "")
    else:
        # UPDATE … SET … FROM other WHERE …: not worth reading; skip it.
        if _top_level(sql[match.end() - 1:where if where >= 0 else len(sql)] + " ", "FROM") >= 0:
            return None
        sources = table
    condition = f" WHERE {tail}" if where >= 0 else ""
    return table, f"SELECT DISTINCT row_to_json({table}.*)::text FROM {sources}{condition}"


def sweep(engine, inserted: dict) -> list[str]:
    """Delete the recorded rows, children before parents; return what refused.

    The order is derived rather than declared: newest table first, and a table
    whose delete is refused by a foreign key (a child of ours not yet gone) is
    retried after the others, until a pass makes no progress.
    """
    from sqlalchemy import tuple_
    from sqlalchemy.exc import DBAPIError

    by_table: dict[str, tuple[Any, list[tuple]]] = {}
    for (name, _text), (table, bound) in inserted.items():
        by_table.setdefault(name, (table, []))[1].append(bound)
        by_table[name] = by_table.pop(name)  # most recently written first
    pending = list(reversed(by_table))
    errors: dict[str, str] = {}
    while pending:
        refused = []
        for name in pending:
            table, keys = by_table[name]
            columns = list(table.primary_key.columns)
            try:
                with engine.begin() as connection:
                    for start in range(0, len(keys), 500):
                        chunk = keys[start:start + 500]
                        if len(columns) == 1:
                            condition = columns[0].in_([key[0] for key in chunk])
                        else:
                            condition = tuple_(*columns).in_(chunk)
                        connection.execute(table.delete().where(condition))
            except DBAPIError as exc:
                # A test's own temporary table (`tests/test_query` probes the
                # operators on one) is gone by teardown, and so are its rows.
                if getattr(getattr(exc, "orig", None), "pgcode", None) == "42P01":
                    continue
                refused.append(name)
                errors[name] = str(getattr(exc, "orig", exc)).strip().splitlines()[0]
        if len(refused) == len(pending):
            return [f"{name}: {errors[name]}" for name in refused]
        pending = refused
    return []


_COLUMNS: dict[str, list[str]] = {}


def _writable_columns(connection, table: str) -> list[str]:
    """The live table's columns, minus generated ones — the model may be ahead."""
    if table not in _COLUMNS:
        from sqlalchemy import text

        _COLUMNS[table] = list(connection.execute(text(
            "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
            "AND table_name = :t AND is_generated = 'NEVER' AND identity_generation IS NULL "
            "ORDER BY ordinal_position"), {"t": table}).scalars())
    return _COLUMNS[table]


def restore(engine, original: dict, metadata, counter: list | None = None) -> list[str]:
    """Put every kept row back as it was: update it, or insert it if it is gone.

    `counter`, when given, receives the number of rows actually written.
    """
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    changed = 0
    pending = list(original.items())
    errors: dict[tuple, str] = {}
    while pending:
        failed = []
        for (name, key), row in pending:
            table = metadata.tables[name]
            names = [c.name for c in table.primary_key.columns]
            try:
                with engine.begin() as connection:
                    columns = _writable_columns(connection, name)
                    if not columns:
                        continue
                    cols = ", ".join(f'"{c}"' for c in columns)
                    match = " AND ".join(f'"{n}"::text = :k{i}' for i, n in enumerate(names))
                    params = {"row": row, **{f"k{i}": v for i, v in enumerate(key)}}
                    source = f"SELECT {cols} FROM json_populate_record(NULL::\"{name}\", CAST(:row AS json))"
                    # Only rows that differ are written: a statement the
                    # test rolled back left nothing to undo.
                    differs = f'row_to_json("{name}".*)::jsonb IS DISTINCT FROM CAST(:row AS jsonb)'
                    updated = connection.execute(
                        text(f'UPDATE "{name}" SET ({cols}) = ({source}) WHERE {match} AND {differs}'
                             if len(columns) > 1 else
                             f'UPDATE "{name}" SET {cols} = ({source}) WHERE {match} AND {differs}'),
                        params,
                    ).rowcount
                    if not updated:
                        updated = connection.execute(
                            text(f'INSERT INTO "{name}" ({cols}) {source} ON CONFLICT DO NOTHING'), params
                        ).rowcount
                    changed += updated
            except DBAPIError as exc:
                failed.append(((name, key), row))
                errors[(name, key)] = str(getattr(exc, "orig", exc)).strip().splitlines()[0]
        if len(failed) == len(pending):
            if counter is not None:
                counter.append(changed)
            return [f"restore {name} {key}: {errors[(name, key)]}" for (name, key), _row in failed]
        pending = failed
    if counter is not None:
        counter.append(changed)
    return []


def recount_tags(engine) -> None:
    """Recompute the derived counts the sweep may have invalidated.

    Deleting a link is not the whole undo when something else caches a count
    of it: a test that tags a seeded record leaves `tags.usage_count`
    incremented on a row seeded months ago. Recomputed rather than
    decremented, the same way the service does — a derived column has one
    truth, and it is the links.
    """
    from sqlalchemy import text

    with engine.begin() as connection:
        connection.execute(
            text(
                'UPDATE "tags" SET usage_count = ('
                '  SELECT count(*) FROM "tag_links" WHERE "tag_links".tag_id = "tags".id'
                ') WHERE usage_count <> ('
                '  SELECT count(*) FROM "tag_links" WHERE "tag_links".tag_id = "tags".id'
                ')'
            )
        )
