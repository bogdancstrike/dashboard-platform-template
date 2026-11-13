import type { KeyboardEvent } from "react";

import { humanChoice, type GridColumn } from "@/lib/gridSheet";

/** The in-cell editor: a select for choices and yes/no, an input otherwise. Enter and Tab commit and move. */
export function CellEditor({
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
