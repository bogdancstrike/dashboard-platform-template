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
import "@/styles/records-analytics.css";

import { Button, Tooltip } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";

import type { GridColumn } from "@/lib/gridSheet";

import { HEAD, OVERSCAN, ROW, ROWHEAD, widthOf, type GridRow } from "./layout";
import { SheetRow } from "./SheetRow";
import { useGridInput } from "./useGridInput";
import { useGridModel } from "./useGridModel";
import { useGridSave } from "./useGridSave";

export type { GridRow } from "./layout";

export function RecordGrid({
  resourceType,
  columns,
  rows: initialRows,
  titleField,
  canEdit,
  height,
  onSaved,
  onPendingChange,
}: {
  resourceType: string;
  columns: GridColumn[];
  rows: GridRow[];
  titleField: string;
  canEdit: boolean;
  height?: number;
  onSaved?: () => void;
  /** Told how many edited cells are waiting, so the page can guard leaving. */
  onPendingChange?: (cells: number) => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const selecting = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(height ?? 600);
  const model = useGridModel({ columns, initialRows, canEdit, sheet });
  const { rows, history, range, tally, saving, step, fillDown, discard } = model;
  const save = useGridSave(model, resourceType, onSaved);
  const { onKeyDown, onCopy, onPaste } = useGridInput(model, save);

  useEffect(() => {
    const el = sheet.current;
    if (!el || height) return;
    setViewport(el.clientHeight || 600);
  }, [height]);
  useEffect(() => onPendingChange?.(tally.cells), [tally.cells, onPendingChange]);

  const template = `${ROWHEAD}px ${columns.map((c) => `${widthOf(c)}px`).join(" ")}`;
  const totalWidth = ROWHEAD + columns.reduce((sum, c) => sum + widthOf(c), 0);
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
        <Tooltip title="Ctrl+Z"><Button onClick={() => step("back")} disabled={!history.past.length} aria-label="Undo">Undo</Button></Tooltip>
        <Tooltip title="Ctrl+Y"><Button onClick={() => step("forward")} disabled={!history.future.length} aria-label="Redo">Redo</Button></Tooltip>
        <Tooltip title="Ctrl+D"><Button onClick={fillDown} disabled={!canEdit || range.bottom === range.top}>Fill down</Button></Tooltip>
        <Button onClick={discard} disabled={!tally.cells}>Discard</Button>
        <Button type="primary" onClick={() => void save()} loading={saving}
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
          {visible.map((row, offset) => (
            <SheetRow
              key={row.id}
              model={model}
              row={row}
              r={start + offset}
              template={template}
              totalWidth={totalWidth}
              titleField={titleField}
              sheet={sheet}
              selecting={selecting}
            />
          ))}
        </div>
      </div>
      <p className="nx-ra-keys">
        <kbd>↑↓←→</kbd> move · <kbd>Shift</kbd> select · <kbd>Enter</kbd>/<kbd>F2</kbd> edit · <kbd>Ctrl</kbd>+<kbd>C</kbd>/<kbd>V</kbd> copy and paste from
        Excel · <kbd>Ctrl</kbd>+<kbd>D</kbd> fill down · <kbd>Ctrl</kbd>+<kbd>Z</kbd>/<kbd>Y</kbd> undo · <kbd>Ctrl</kbd>+<kbd>S</kbd> save
      </p>
    </div>
  );
}
