/** The explorer's address, read: views, numbers, the tree and filters in the URL, and what a saved search stores. */

import { type ExplorerResource, type ExplorerView, type SavedSearch } from "@/api/explorer";
import { humanise } from "@/components/explorer/ConditionBuilder";

export const VIEW_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "list", label: "List" },
  { value: "cards", label: "Cards" },
  { value: "compact", label: "Compact" },
];

/**
 * "Try" chips for the start screen: real values of the dataset's first two
 * choice fields, each one a filter that reproduces it. Never the design's
 * sample sentences — a chip that answers nothing is a chip nobody presses twice.
 */
export function trySuggestions(resource?: ExplorerResource) {
  if (!resource) return [];
  const enums = resource.fields.filter((field) => field.kind === "enum" && field.filterable && field.choices.length > 0).slice(0, 2);
  return enums.flatMap((field) =>
    field.choices.slice(0, 3).map((value) => ({
      field: field.name,
      value,
      label: `${field.label.toLowerCase()}: ${humanise(value).toLowerCase()}`,
    })),
  ).slice(0, 5);
}

/**
 * The question a saved search stores, in the shape the form saves back.
 *
 * Editing a saved search must not silently rewrite its question to whatever
 * happens to be on screen: renaming somebody's "Critical work" should not turn
 * it into the customer list the editor was looking at when they renamed it.
 */
export function savedQuestion(search: SavedSearch) {
  return {
    resource_type: search.resource_type,
    condition_tree: search.condition_tree,
    filters: search.filters,
    query_text: search.query_text,
    sort: search.sort,
    order: search.order,
    columns: search.columns,
    page_size: search.page_size,
    view_mode: search.view_mode,
  };
}

export function parseTree(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseFilters(params: URLSearchParams): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  params.forEach((value, key) => {
    if (key.startsWith("f.") && value) out[key.slice(2)] = value.split(",").filter(Boolean);
  });
  return out;
}

export function asView(value: string | null): ExplorerView {
  return value === "list" || value === "cards" || value === "compact" ? value : "table";
}

export function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
