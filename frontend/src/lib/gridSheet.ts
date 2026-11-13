/**
 * The pure half of the bulk-edit grid (§18): reading a pasted block, turning
 * a typed or pasted string into the value a column stores, writing a block
 * back out, and the undo history. No React here, so every rule is a unit
 * test away.
 */

export type GridKind = "text" | "number" | "enum" | "bool" | "datetime";

export interface GridColumn {
  name: string;
  label: string;
  kind: GridKind;
  editable: boolean;
  required?: boolean;
  minimum?: number | null;
  maximum?: number | null;
  choices?: string[];
}

export interface Coerced {
  value: unknown;
  error?: string;
}

/**
 * A clipboard block as rows of cells. Excel and Sheets put TSV on the
 * clipboard; a CSV file opened in an editor gives commas — so a block with
 * tabs is TSV, one without tabs but with commas is CSV. Quoted cells may hold
 * the separator, doubled quotes and line breaks.
 */
export function parseClipboard(text: string): string[][] {
  const source = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (!source) return [];
  const separator = source.includes("\t") ? "\t" : source.includes(",") ? "," : "\t";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** A block as TSV, quoting what would otherwise break a cell. */
export function toTSV(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => (/[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join("\t"))
    .join("\n");
}

function normaliseEnum(text: string): string {
  return text.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** "1 234,50 €", "$1,234.50", "12%" → a number. */
export function parseNumber(raw: string): number | null {
  let text = raw.trim().replace(/[€$£%\s ]/g, "");
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Whichever comes last is the decimal mark.
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
  } else if (lastComma > -1) {
    // "1,234" is a thousands group; "12,5" is a decimal.
    text = /^-?\d{1,3}(,\d{3})+$/.test(text) ? text.replace(/,/g, "") : text.replace(",", ".");
  }
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? (negative ? -value : value) : null;
}

/** ISO, "31/12/2026", "31.12.2026" and "2026/12/31" → "2026-12-31". */
export function parseDate(raw: string): string | null {
  const text = raw.trim();
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ].*)?$/.exec(text);
  let year: number, month: number, day: number;
  if (match) {
    [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  } else {
    match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
    if (!match) return null;
    [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function humanChoice(value: string): string {
  const text = value.toLowerCase().replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One typed or pasted string as the value the column stores, or why not. */
export function coerceCell(raw: string, column: GridColumn): Coerced {
  const text = raw.trim();
  if (!column.editable) return { value: undefined, error: `${column.label} cannot be edited here.` };
  if (text === "") {
    if (column.required) return { value: null, error: `${column.label} cannot be empty.` };
    return { value: column.kind === "bool" ? false : null };
  }
  switch (column.kind) {
    case "number": {
      const value = parseNumber(text);
      if (value === null) return { value: text, error: `“${text}” is not a number.` };
      if (column.minimum !== null && column.minimum !== undefined && value < column.minimum) {
        return { value, error: `${column.label} must be at least ${column.minimum}.` };
      }
      if (column.maximum !== null && column.maximum !== undefined && value > column.maximum) {
        return { value, error: `${column.label} must be at most ${column.maximum}.` };
      }
      return { value };
    }
    case "enum": {
      const choices = column.choices ?? [];
      const wanted = normaliseEnum(text);
      const hit = choices.find((choice) => choice === wanted || normaliseEnum(humanChoice(choice)) === wanted);
      if (!hit && choices.length) {
        return { value: text, error: `“${text}” is not one of ${choices.map(humanChoice).join(", ")}.` };
      }
      return { value: hit ?? wanted };
    }
    case "bool": {
      const lower = text.toLowerCase();
      if (["true", "yes", "y", "1", "x", "✓"].includes(lower)) return { value: true };
      if (["false", "no", "n", "0", "-"].includes(lower)) return { value: false };
      return { value: text, error: `“${text}” is not yes or no.` };
    }
    case "datetime": {
      const value = parseDate(text);
      if (!value) return { value: text, error: `“${text}” is not a date (YYYY-MM-DD or DD/MM/YYYY).` };
      return { value };
    }
    default:
      return { value: text };
  }
}

/** How a stored value reads in a cell, and on the clipboard. */
export function displayCell(value: unknown, column: GridColumn): string {
  if (value === null || value === undefined || value === "") return "";
  if (column.kind === "bool") return value ? "Yes" : "No";
  if (column.kind === "enum") return humanChoice(String(value));
  if (column.kind === "datetime") return String(value).slice(0, 10);
  if (column.kind === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(value);
  }
  return String(value);
}

// ── selection ────────────────────────────────────────────────────────────

export interface Cell {
  row: number;
  col: number;
}

export interface Range {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export function rangeOf(anchor: Cell, focus: Cell): Range {
  return {
    top: Math.min(anchor.row, focus.row),
    bottom: Math.max(anchor.row, focus.row),
    left: Math.min(anchor.col, focus.col),
    right: Math.max(anchor.col, focus.col),
  };
}

export function inRange(range: Range, row: number, col: number): boolean {
  return row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
}

export function clamp(cell: Cell, rows: number, cols: number): Cell {
  return { row: Math.max(0, Math.min(rows - 1, cell.row)), col: Math.max(0, Math.min(cols - 1, cell.col)) };
}

// ── edits and history ────────────────────────────────────────────────────

export interface CellEdit {
  rowId: string;
  field: string;
  /** The pending entry before this edit — undefined when there was none. */
  before: PendingCell | undefined;
  after: PendingCell | undefined;
}

interface PendingCell {
  value: unknown;
  error?: string;
}

/** Pending changes: row id → field → the value waiting to be saved. */
export type Pending = Record<string, Record<string, PendingCell>>;

export function applyEdits(pending: Pending, edits: CellEdit[], direction: "forward" | "back"): Pending {
  const next: Pending = { ...pending };
  const ordered = direction === "forward" ? edits : [...edits].reverse();
  for (const edit of ordered) {
    const target = direction === "forward" ? edit.after : edit.before;
    const row = { ...(next[edit.rowId] ?? {}) };
    if (target === undefined) delete row[edit.field];
    else row[edit.field] = target;
    if (Object.keys(row).length) next[edit.rowId] = row;
    else delete next[edit.rowId];
  }
  return next;
}

export interface History {
  past: CellEdit[][];
  future: CellEdit[][];
}

export const emptyHistory: History = { past: [], future: [] };

export function record(history: History, edits: CellEdit[], limit = 100): History {
  if (edits.length === 0) return history;
  return { past: [...history.past.slice(-(limit - 1)), edits], future: [] };
}

export function undo(history: History): { history: History; edits: CellEdit[] | null } {
  const edits = history.past[history.past.length - 1];
  if (!edits) return { history, edits: null };
  return { history: { past: history.past.slice(0, -1), future: [edits, ...history.future] }, edits };
}

export function redo(history: History): { history: History; edits: CellEdit[] | null } {
  const edits = history.future[0];
  if (!edits) return { history, edits: null };
  return { history: { past: [...history.past, edits], future: history.future.slice(1) }, edits };
}

/** Pending changes ready to send: only valid ones, per row. */
export function savable(pending: Pending): { id: string; changes: Record<string, unknown> }[] {
  return Object.entries(pending)
    .map(([id, fields]) => ({
      id,
      changes: Object.fromEntries(Object.entries(fields).filter(([, cell]) => !cell.error).map(([name, cell]) => [name, cell.value])),
    }))
    .filter((row) => Object.keys(row.changes).length > 0);
}

export function counts(pending: Pending): { cells: number; invalid: number; rows: number } {
  let cells = 0;
  let invalid = 0;
  for (const fields of Object.values(pending)) {
    for (const cell of Object.values(fields)) {
      cells += 1;
      if (cell.error) invalid += 1;
    }
  }
  return { cells, invalid, rows: Object.keys(pending).length };
}
