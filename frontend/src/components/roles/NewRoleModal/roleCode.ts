import type { NxIconName } from "@/components/NxIcon";

/**
 * The code a name produces.
 *
 * Pure and exported: the server validates the same shape (`[A-Z0-9_]{2,48}`),
 * and a preview that suggested something the server refuses would be a form
 * that fails on its own suggestion.
 */
export function codeFor(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/** An icon for a permission area, by the words in its name. */
export function groupIcon(name: string): NxIconName {
  const n = name.toLowerCase();
  if (n.includes("record")) return "briefcase";
  if (n.includes("work") || n.includes("task")) return "check";
  if (n.includes("report") || n.includes("analy") || n.includes("dashboard")) return "bars";
  if (n.includes("admin") || n.includes("user") || n.includes("role")) return "shield";
  if (n.includes("system") || n.includes("platform")) return "gear";
  if (n.includes("data")) return "database";
  return "grid";
}
