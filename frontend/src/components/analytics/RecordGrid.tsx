/**
 * The bulk-edit grid (§18): a spreadsheet over a record list.
 *
 * * **Virtualised** — only the rows in view (plus a margin) are in the DOM, so
 *   five hundred rows scroll like fifty.
 * * **Keyboard first** — arrows move, Shift+arrows select, Tab/Enter move on,
 *   F2 or typing edits, Escape cancels, Delete clears, Ctrl+C copies, Ctrl+V
 *   pastes, Ctrl+D fills down, Ctrl+Z / Ctrl+Y undo and redo, Ctrl+S saves.
 * * **Paste from Excel or a CSV** — a block lands at the active cell; every
 *   cell is coerced to its column's type (numbers with currency and
 *   separators, labels for statuses, several date formats) and a cell that
 *   cannot be is marked with the reason.
 * * **Pending, then saved** — edited cells are highlighted until "Save"
 *   sends them through the records bulk API, one change set per row; the
 *   answer marks what was applied and puts the server's reason on any cell
 *   it refused.
 */
import "@/styles/analytics.css";

import { App, Button, Tooltip } from "antd";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";

import { gridApi } from "@/api/recordsAnalytics";
import { errorText } from "@/lib/errors";
import {
  applyEdits,
  clamp,
  coerceCell,
  counts,
  displayCell,
  emptyHistory,
  humanChoice,
  inRange,
  parseClipboard,
  rangeOf,
  record,
  redo,
  savable,
  toTSV,
  undo,
  type Cell,
  type CellEdit,
  type GridColumn,
  type History,
  type Pending,
} from "@/lib/gridSheet";

const ROW = 34;
const HEAD = 36;
const OVERSCAN = 8;
const ROWHEAD = 120;

export interface GridRow {
  id: string;
  [field: string]: unknown;
}

function widthOf(column: GridColumn): number {
  if (column.kind === "bool") return 100;
  if (column.kind === "number" || column.kind === "datetime") return 130;
  if (column.kind === "enum") return 150;
  return 220;
}

export function RecordGrid({
  resourceType,
  columns,
  rows: initialRows,
  titleField,
  canEdit,
  height,
  onSaved,
}: {
  resourceType: string;
  columns: GridColumn[];
  rows: GridRow[];
  titleField: string;
  canEdit: boolean;
  height?: number;
  onSaved?: () => void;
}) {
  const { message } = App.useApp();
  const [rows, setRows] = useState<GridRow[]>(initialRows);
  const [pending, setPending] = useState<Pending>({});
  const [history, setHistory] = useState<History>(emptyHistory);
  const [anchor, setAnchor] = useState<Cell>({ row: 0, col: 0 });
  const [focus, setFocus] = useState<Cell>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<{ cell: Cell; draft: string } | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(height ?? 600);
  const sheet = useRef<HTMLDivElement>(null);
  const selecting = useRef(false);

  useEffect(() => setRows(initialRows), [initialRows]);
  useEffect(() => {
    const el = sheet.current;
    if (!el || height) return;
    setViewport(el.clientHeight || 600);
  }, [height]);

  const template = `${ROWHEAD}px ${columns.map((c) => `${widthOf(c)}px`).join(" ")}`;
  const totalWidth = ROWHEAD + columns.reduce((sum, c) => sum + widthOf(c), 0);
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
    [rows.length, columns.length],
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

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[key]) {
      event.preventDefault();
      const [dr, dc] = arrows[key]!;
      const jump = mod ? (dr ? rows.length : columns.length) : 1;
      moveTo({ row: focus.row + dr * jump, col: focus.col + dc * jump }, event.shiftKey);
      return;
    }
    if (key === "Tab") {
      event.preventDefault();
      moveTo({ row: focus.row, col: focus.col + (event.shiftKey ? -1 : 1) });
      return;
    }
    if (mod && key.toLowerCase() === "z") {
      event.preventDefault();
      step(event.shiftKey ? "forward" : "back");
      return;
    }
    if (mod && key.toLowerCase() === "y") {
      event.preventDefault();
      step("forward");
      return;
    }
    if (mod && key.toLowerCase() === "d") {
      event.preventDefault();
      if (canEdit) fillDown();
      return;
    }
    if (mod && key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
      return;
    }
    if (mod && key.toLowerCase() === "a") {
      event.preventDefault();
      setAnchor({ row: 0, col: 0 });
      setFocus({ row: rows.length - 1, col: columns.length - 1 });
      return;
    }
    if (mod) return; // let copy and paste reach their events
    if (key === "Enter" || key === "F2") {
      event.preventDefault();
      startEdit(focus);
      return;
    }
    if (key === "Escape") {
      setAnchor(focus);
      return;
    }
    if ((key === "Delete" || key === "Backspace") && canEdit) {
      event.preventDefault();
      clearSelection();
      return;
    }
    if (key.length === 1 && !event.altKey) {
      event.preventDefault();
      startEdit(focus, key);
    }
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selectionTSV());
    const cells = (range.bottom - range.top + 1) * (range.right - range.left + 1);
    void message.info(`Copied ${cells} cell${cells === 1 ? "" : "s"}.`);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !canEdit) return;
    event.preventDefault();
    const block = parseClipboard(event.clipboardData.getData("text/plain"));
    if (!block.length) return;
    const origin = { row: range.top, col: range.left };
    const cells: { row: number; col: number; raw: string }[] = [];
    let skipped = 0;
    block.forEach((line, r) =>
      line.forEach((raw, c) => {
        const row = origin.row + r;
        const col = origin.col + c;
        if (row >= rows.length || col >= columns.length) skipped += 1;
        else if (!columns[col]!.editable) skipped += 1;
        else cells.push({ row, col, raw });
      }),
    );
    const changed = write(cells);
    setAnchor(origin);
    setFocus(clamp({ row: origin.row + block.length - 1, col: origin.col + Math.max(...block.map((l) => l.length)) - 1 }, rows.length, columns.length));
    void message.info(`Pasted ${block.length}×${Math.max(...block.map((l) => l.length))} — ${changed} cell${changed === 1 ? "" : "s"} changed${skipped ? `, ${skipped} outside the editable grid skipped` : ""}.`);
  };

  async function save() {
    const batch = savable(pending);
    if (!batch.length || saving) return;
    setSaving(true);
    try {
      const updatedAt = new Map(rows.map((row) => [row.id, row.updated_at as string | undefined]));
      const result = await gridApi.save(
        resourceType,
        batch.map((row) => ({ ...row, expected_updated_at: updatedAt.get(row.id) ?? null })),
      );
      const flashed = new Set<string>();
      let next = { ...pending };
      const byId = new Map(result.results.map((r) => [r.id, r]));
      setRows((current) =>
        current.map((row) => {
          const outcome = byId.get(row.id);
          const sent = batch.find((b) => b.id === row.id);
          if (!outcome || !sent || outcome.status === "failed") return row;
          return { ...row, ...sent.changes, ...(outcome.updated_at ? { updated_at: outcome.updated_at } : {}) };
        }),
      );
      for (const sent of batch) {
        const outcome = byId.get(sent.id);
        if (!outcome) continue;
        const fields = { ...(next[sent.id] ?? {}) };
        if (outcome.status === "failed") {
          const problems = new Map(outcome.problems.map((p) => [p.field, p.message]));
          for (const field of Object.keys(sent.changes)) {
            const reason = problems.get(field) ?? (outcome.problems.length ? undefined : outcome.message);
            if (reason) fields[field] = { ...fields[field]!, error: reason };
          }
        } else {
          for (const field of Object.keys(sent.changes)) {
            delete fields[field];
            flashed.add(`${sent.id}:${field}`);
          }
        }
        if (Object.keys(fields).length) next[sent.id] = fields;
        else delete next[sent.id];
      }
      setPending(next);
      setHistory(emptyHistory);
      setSaved(flashed);
      window.setTimeout(() => setSaved(new Set()), 1400);
      if (result.failed.length) void message.warning(result.message);
      else void message.success(result.message);
      onSaved?.();
    } catch (error) {
      void message.error(errorText(error, { action: "edit these records" }));
    } finally {
      setSaving(false);
    }
  }

  const discard = () => {
    setPending({});
    setHistory(emptyHistory);
  };

  const start = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewport) / ROW) + OVERSCAN);
  const visible = useMemo(() => rows.slice(start, end), [rows, start, end]);

  return (
    <div className="nx-ra-sheet-wrap">
      <div className="nx-ra-sheet-bar">
        <span className="nx-ra-pill">{rows.length} rows</span>
        {tally.cells > 0 && <span className="nx-ra-pill nx-ra-pill--warn" data-testid="grid-pending">{tally.cells} pending in {tally.rows} row{tally.rows === 1 ? "" : "s"}</span>}
        {tally.invalid > 0 && <span className="nx-ra-pill nx-ra-pill--bad" data-testid="grid-invalid">{tally.invalid} invalid</span>}
        <span className="nx-ra-spacer" />
        <Tooltip title="Ctrl+Z"><Button size="small" onClick={() => step("back")} disabled={!history.past.length} aria-label="Undo">Undo</Button></Tooltip>
        <Tooltip title="Ctrl+Y"><Button size="small" onClick={() => step("forward")} disabled={!history.future.length} aria-label="Redo">Redo</Button></Tooltip>
        <Tooltip title="Ctrl+D"><Button size="small" onClick={fillDown} disabled={!canEdit || range.bottom === range.top}>Fill down</Button></Tooltip>
        <Button size="small" onClick={discard} disabled={!tally.cells}>Discard</Button>
        <Button type="primary" size="small" onClick={() => void save()} loading={saving}
          disabled={!canEdit || tally.cells - tally.invalid === 0} data-testid="grid-save">
          Save {tally.cells - tally.invalid || ""}
        </Button>
      </div>
      <div
        ref={sheet}
        className="nx-ra-sheet"
        style={height ? { height } : undefined}
        tabIndex={0}
        role="grid"
        aria-label="Records grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length + 1}
        data-testid="record-grid"
        onKeyDown={onKeyDown}
        onCopy={onCopy}
        onPaste={onPaste}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onMouseUp={() => (selecting.current = false)}
        onMouseLeave={() => (selecting.current = false)}
      >
        <div className="nx-ra-sheet-inner" style={{ width: totalWidth, height: HEAD + rows.length * ROW }}>
          <div className="nx-ra-sheet-head" role="row" style={{ gridTemplateColumns: template, width: totalWidth }}>
            <div role="columnheader">Record</div>
            {columns.map((column) => (
              <div key={column.name} role="columnheader" title={column.editable ? column.label : `${column.label} (read-only)`}>
                {column.label}
                {!column.editable && " 🔒"}
              </div>
            ))}
          </div>
          {visible.map((row, offset) => {
            const r = start + offset;
            return (
              <div key={row.id} className="nx-ra-sheet-row" role="row" aria-rowindex={r + 2}
                style={{ top: HEAD + r * ROW, gridTemplateColumns: template, width: totalWidth }}>
                <div className="nx-ra-cell is-rowhead" role="rowheader" title={String(row[titleField] ?? row.id)}>
                  {String(row[titleField] ?? row.id)}
                </div>
                {columns.map((column, c) => {
                  const pendingCell = pending[row.id]?.[column.name];
                  const value = pendingCell ? pendingCell.value : row[column.name];
                  const active = focus.row === r && focus.col === c;
                  const isEditing = editing && editing.cell.row === r && editing.cell.col === c;
                  const classes = [
                    "nx-ra-cell",
                    column.kind === "number" ? "is-num" : "",
                    column.editable ? "" : "is-readonly",
                    inRange(range, r, c) ? "is-selected" : "",
                    active ? "is-active" : "",
                    pendingCell ? (pendingCell.error ? "is-invalid" : "is-pending") : "",
                    saved.has(`${row.id}:${column.name}`) ? "is-saved" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <div
                      key={column.name}
                      className={classes}
                      role="gridcell"
                      aria-selected={inRange(range, r, c)}
                      aria-invalid={pendingCell?.error ? true : undefined}
                      title={pendingCell?.error ?? displayCell(value, column)}
                      data-cell={`${r}:${c}`}
                      onMouseDown={(event) => {
                        if (isEditing) return;
                        event.preventDefault();
                        sheet.current?.focus();
                        if (editing) commitEdit();
                        selecting.current = true;
                        moveTo({ row: r, col: c }, event.shiftKey);
                      }}
                      onMouseEnter={() => selecting.current && setFocus({ row: r, col: c })}
                      onDoubleClick={() => startEdit({ row: r, col: c })}
                    >
                      {isEditing ? (
                        <CellEditor
                          column={column}
                          draft={editing.draft}
                          onChange={(draft) => setEditing({ cell: editing.cell, draft })}
                          onCommit={(move) => commitEdit(move ? { row: r + move[0], col: c + move[1] } : undefined)}
                          onCancel={() => {
                            // The blur that follows must not commit the draft.
                            committed.current = editing;
                            setEditing(null);
                            sheet.current?.focus();
                          }}
                        />
                      ) : (
                        displayCell(value, column)
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      <p className="nx-ra-keys">
        <kbd>↑↓←→</kbd> move · <kbd>Shift</kbd> select · <kbd>Enter</kbd>/<kbd>F2</kbd> edit · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copy and paste from
        Excel · <kbd>Ctrl</kbd>+<kbd>D</kbd> fill down · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo · <kbd>Ctrl</kbd>+<kbd>S</kbd> save
      </p>
    </div>
  );
}

function CellEditor({
  column,
  draft,
  onChange,
  onCommit,
  onCancel,
}: {
  column: GridColumn;
  draft: string;
  onChange: (draft: string) => void;
  onCommit: (move?: [number, number]) => void;
  onCancel: () => void;
}) {
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit([1, 0]);
    } else if (event.key === "Tab") {
      event.preventDefault();
      onCommit([0, event.shiftKey ? -1 : 1]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };
  if (column.kind === "enum" || column.kind === "bool") {
    const options = column.kind === "bool" ? ["Yes", "No"] : (column.choices ?? []).map(humanChoice);
    return (
      <select autoFocus value={draft} onChange={(event) => onChange(event.target.value)} onKeyDown={keys}
        onBlur={() => onCommit()} aria-label={column.label}>
        {!column.required && <option value="">—</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  return (
    <input
      autoFocus
      type={column.kind === "datetime" && /^\d{4}-\d{2}-\d{2}$/.test(draft) ? "date" : "text"}
      inputMode={column.kind === "number" ? "decimal" : undefined}
      value={draft}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={keys}
      onBlur={() => onCommit()}
      aria-label={column.label}
    />
  );
}
