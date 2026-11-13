/** Pending edits, the undo history, and what a save sends. */

export interface CellEdit {
  rowId: string;
  field: string;
  /** The pending entry before this edit — undefined when there was none. */
  before: PendingCell | undefined;
  after: PendingCell | undefined;
}

export interface PendingCell {
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
