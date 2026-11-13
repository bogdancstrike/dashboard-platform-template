/** The active cell, the selected range, and keeping both inside the sheet. */

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
