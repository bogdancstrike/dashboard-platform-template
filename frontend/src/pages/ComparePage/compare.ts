import type { Comparison } from "@/api/compare";
import { humanStatus } from "@/components/StatusTag";
import { asText } from "@/lib/text";

/** What the reader is looking at, in one sentence. */
export function summarise(comparison: Comparison | undefined): string {
  if (!comparison) return "";
  const { records, differing, same } = comparison;
  if (differing === 0) {
    return `${records.length} ${comparison.resource_label.toLowerCase()} — identical in all ${same} fields`;
  }
  return `${records.length} ${comparison.resource_label.toLowerCase()} · ${differing} field${
    differing === 1 ? "" : "s"
  } differ · ${same} the same`;
}

/** The ids to compare, from the address. Order is the reader's. */
export function idsFrom(raw: string | null): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(",")
        .map((piece) => piece.trim())
        .filter(Boolean),
    ),
  ];
}

/**
 * A compared value as a person reads it: a date rather than an ISO stamp, a
 * number with its separators, a vocabulary value in words. The raw value is
 * what the server compared; this is only how it is shown.
 */
export function readable(value: unknown, kind: string): string {
  const text = asText(value);
  if (kind === "datetime" || kind === "date") {
    const when = new Date(text);
    return Number.isNaN(when.getTime()) ? text : when.toLocaleDateString();
  }
  if (kind === "number" && typeof value === "number") return value.toLocaleString();
  if (kind === "enum") return humanStatus(text);
  return text;
}
