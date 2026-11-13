/** Column kinds, and turning a typed or pasted string into the value a column stores — and back. */

import { asText } from "@/lib/text";

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

function normaliseEnum(text: string): string {
  return text.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

/** "1 234,50 €", "$1,234.50", "12%" → a number. */
export function parseNumber(raw: string): number | null {
  let text = raw.trim().replace(/[€$£%\s\u00a0]/g, "");
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
  if (column.kind === "enum") return humanChoice(asText(value));
  if (column.kind === "datetime") return asText(value).slice(0, 10);
  if (column.kind === "number") {
    const n = Number(value);
    return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : asText(value);
  }
  return asText(value);
}
