import type { MutableRefObject, RefObject } from "react";

import { displayCell, inRange } from "@/lib/gridSheet";

import { CellEditor } from "./CellEditor";
import { displayText, HEAD, ROW, type GridRow } from "./layout";
import type { GridModel } from "./useGridModel";

/** One record's row: its heading, then a cell per column — selected, pending, invalid or just saved. */
export function SheetRow({
  model,
  row,
  r,
  template,
  totalWidth,
  titleField,
  sheet,
  selecting,
}: {
  model: GridModel;
  row: GridRow;
  /** The row's index in the whole sheet, not in the rendered window. */
  r: number;
  template: string;
  totalWidth: number;
  titleField: string;
  sheet: RefObject<HTMLDivElement>;
  /** True while the mouse is held down to drag a selection. */
  selecting: MutableRefObject<boolean>;
}) {
  const { columns, pending, focus, editing, range, saved, commitEdit, cancelEdit, moveTo, setFocus, setEditing, startEdit } = model;
  return (
    <div className="nx-ra-sheet-row" role="row" aria-rowindex={r + 2}
      style={{ top: HEAD + r * ROW, gridTemplateColumns: template, width: totalWidth }}>
      <div className="nx-ra-cell is-rowhead" role="rowheader" title={displayText(row[titleField] ?? row.id)}>
        {displayText(row[titleField] ?? row.id)}
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
                onCancel={cancelEdit}
              />
            ) : (
              displayCell(value, column)
            )}
          </div>
        );
      })}
    </div>
  );
}
