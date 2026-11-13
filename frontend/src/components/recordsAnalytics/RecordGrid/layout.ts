/** The grid's geometry and the row shape it edits. */

import type { GridColumn } from "@/lib/gridSheet";

export const ROW = 34;
export const HEAD = 36;
export const OVERSCAN = 8;
export const ROWHEAD = 120;

export interface GridRow {
  id: string;
  [field: string]: unknown;
}

/** A column's width, by the kind of value it holds. */
export function widthOf(column: GridColumn): number {
  if (column.kind === "bool") return 100;
  if (column.kind === "number" || column.kind === "datetime") return 130;
  if (column.kind === "enum") return 150;
  return 220;
}

/** A row's heading cell as text — a nested value would otherwise read "[object Object]". */
export function displayText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return `${value}`;
  return value === null || value === undefined ? "" : JSON.stringify(value);
}
