import type { ExplorerResult } from "@/api/explorer";
import { asText } from "@/lib/text";

import { ExplorerRecord } from "./index";

export interface Section {
  value: string;
  label: string;
  rows: ExplorerRecord[];
  /** How many the whole result holds, from the facet counts. */
  total: number;
}

/**
 * Section a result by one field, biggest first.
 *
 * The sections come from the **facet counts**, which the server computed over
 * the whole result, and the loaded rows are filed into them. Building them
 * from the loaded rows instead — which is what this did — silently drops any
 * group with nothing on the first page: at 500 tasks the 34 blocked ones had
 * no row among the first 25, so the section vanished and the headings stopped
 * adding up to the total. The reader was looking at a breakdown of the answer
 * that was missing a part of the answer, with nothing to say so.
 *
 * A section with no rows yet is therefore kept, showing what it holds. It is
 * the difference between "there are no blocked tasks" and "you have not
 * scrolled to them".
 */
export function group(rows: ExplorerRecord[], field: string, result?: ExplorerResult): Section[] {
  const totals = new Map(
    (result?.facets[field] ?? []).map((entry) => [entry.value, entry.count] as const),
  );

  // Every group the server reported, in the order it reported them, and then
  // any value a loaded row carries that the facet list did not mention — the
  // facet query is capped, so a high-cardinality field can hand back rows from
  // outside the top of the list.
  const sections = new Map<string, ExplorerRecord[]>();
  for (const value of totals.keys()) sections.set(value, []);
  for (const row of rows) {
    const value = asText(row[field]);
    const bucket = sections.get(value);
    if (bucket) bucket.push(row);
    else sections.set(value, [row]);
  }

  return [...sections.entries()]
    .map(([value, sectionRows]) => ({
      value,
      // An absent value is a group of its own, and saying so beats an empty
      // heading the reader has to guess at.
      label: value === "" ? "No value" : value.replaceAll("_", " "),
      rows: sectionRows,
      total: totals.get(value) ?? 0,
    }))
    .sort((a, b) => (b.total || b.rows.length) - (a.total || a.rows.length));
}

export function title(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
