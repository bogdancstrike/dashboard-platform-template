import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import {
  applyEdits,
  clamp,
  coerceCell,
  counts,
  displayCell,
  emptyHistory,
  rangeOf,
  record,
  redo,
  toTSV,
  undo,
  type Cell,
  type CellEdit,
  type GridColumn,
  type History,
  type Pending,
} from "@/lib/gridSheet";

import { HEAD, ROW, type GridRow } from "./layout";

/**
 * The grid's model, apart from its view: the rows, the pending edits and
 * their undo history, the selection, the cell being edited, and every
 * operation on them — write, move, edit, undo, fill, clear, copy out.
 */
export function useGridModel({
  columns,
  initialRows,
  canEdit,
  sheet,
}: {
  columns: GridColumn[];
  initialRows: GridRow[];
  canEdit: boolean;
  /** The sheet element, kept scrolled to the active row and given focus back after an edit. */
  sheet: RefObject<HTMLDivElement>;
}) {
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [pending, setPending] = useState<Pending>({});
  const [history, setHistory] = useState<History>(emptyHistory);
  const [anchor, setAnchor] = useState<Cell>({ row: 0, col: 0 });
  const [focus, setFocus] = useState<Cell>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<{ cell: Cell; draft: string } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => setRows(initialRows), [initialRows]);

  const range = rangeOf(anchor, focus);
  const tally = counts(pending);

  const valueAt = useCallback(
    (row: GridRow, column: GridColumn) => {
      const cell = pending[row.id]?.[column.name];
      return cell ? cell.value : row[column.name];
    },
    [pending],
  );

  /** Put new strings into cells: coerce each, record one undoable step. */
  const write = useCallback(
    (cells: { row: number; col: number; raw: string }[]) => {
      const edits: CellEdit[] = [];
      for (const { row, col, raw } of cells) {
        const target = rows[row];
        const column = columns[col];
        if (!target || !column || !column.editable) continue;
        const coerced = coerceCell(raw, column);
        const original = target[column.name];
        const before = pending[target.id]?.[column.name];
        const same = !coerced.error && JSON.stringify(coerced.value ?? null) === JSON.stringify(original ?? null);
        const after = same ? undefined : { value: coerced.value, ...(coerced.error ? { error: coerced.error } : {}) };
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        edits.push({ rowId: target.id, field: column.name, before, after });
      }
      if (!edits.length) return 0;
      setPending((current) => applyEdits(current, edits, "forward"));
      setHistory((current) => record(current, edits));
      return edits.length;
    },
    [rows, columns, pending],
  );

  const moveTo = useCallback(
    (cell: Cell, extend = false) => {
      const next = clamp(cell, rows.length, columns.length);
      setFocus(next);
      if (!extend) setAnchor(next);
      // Keep the active row in view.
      const el = sheet.current;
      if (el) {
        const top = next.row * ROW;
        if (top < el.scrollTop) el.scrollTop = top;
        else if (top + ROW > el.scrollTop + el.clientHeight - HEAD) el.scrollTop = top + ROW - el.clientHeight + HEAD;
      }
    },
    [rows.length, columns.length, sheet],
  );

  const startEdit = (cell: Cell, draft?: string) => {
    const column = columns[cell.col];
    const row = rows[cell.row];
    if (!canEdit || !column?.editable || !row) return;
    setEditing({ cell, draft: draft ?? displayCell(valueAt(row, column), column) });
  };

  // A blur can follow an Enter that already committed; this makes the second a no-op.
  const committed = useRef<{ cell: Cell; draft: string } | null>(null);
  const commitEdit = (move?: Cell) => {
    if (!editing || committed.current === editing) return;
    committed.current = editing;
    write([{ ...editing.cell, raw: editing.draft }]);
    setEditing(null);
    if (move) moveTo(move);
    sheet.current?.focus();
  };

  const step = (direction: "back" | "forward") => {
    const result = direction === "back" ? undo(history) : redo(history);
    if (!result.edits) return;
    setPending((current) => applyEdits(current, result.edits!, direction));
    setHistory(result.history);
  };

  const selectionTSV = () => {
    const block: string[][] = [];
    for (let r = range.top; r <= range.bottom; r += 1) {
      const row = rows[r];
      if (!row) continue;
      block.push(columns.slice(range.left, range.right + 1).map((column) => displayCell(valueAt(row, column), column)));
    }
    return toTSV(block);
  };

  const fillDown = () => {
    if (range.bottom === range.top) return;
    const source = rows[range.top];
    if (!source) return;
    const cells = [];
    for (let r = range.top + 1; r <= range.bottom; r += 1) {
      for (let c = range.left; c <= range.right; c += 1) {
        const column = columns[c]!;
        cells.push({ row: r, col: c, raw: displayCell(valueAt(source, column), column) });
      }
    }
    write(cells);
  };

  const clearSelection = () => {
    const cells = [];
    for (let r = range.top; r <= range.bottom; r += 1) {
      for (let c = range.left; c <= range.right; c += 1) cells.push({ row: r, col: c, raw: "" });
    }
    write(cells);
  };

  /** Leave the editor without writing; the blur that follows must not commit the draft. */
  const cancelEdit = () => {
    committed.current = editing;
    setEditing(null);
    sheet.current?.focus();
  };

  const discard = () => {
    setPending({});
    setHistory(emptyHistory);
  };

  return {
    columns, canEdit, rows, setRows, pending, setPending, history, setHistory, anchor, setAnchor, focus, setFocus,
    editing, setEditing, saved, setSaved, saving, setSaving, range, tally, valueAt, write, moveTo, startEdit,
    commitEdit, cancelEdit, step, selectionTSV, fillDown, clearSelection, discard,
  };
}

export type GridModel = ReturnType<typeof useGridModel>;
