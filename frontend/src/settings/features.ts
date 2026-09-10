/**
 * Feature flags, read (§27).
 *
 * There was a whole flag system — rollout percentages, target roles, named
 * users, a stable hash so a flag cannot flicker — an administration screen to
 * manage it, and **nothing anywhere that read a flag**. Toggling one changed
 * no navigation and no page, which makes the screen a set of switches wired to
 * nothing and the audit trail behind it a record of nothing happening.
 *
 * Three decisions.
 *
 * **The answer comes from the server, with the profile.** `/api/me` publishes
 * the keys that are on for *this* reader, computed by the same function the
 * flags screen reports `on_for_me` with. The rollout rule is not reimplemented
 * here — a browser that decided its own percentage would disagree with the
 * screen that explains it, and "it says it is on and I do not have it" would
 * be unanswerable.
 *
 * **A flag gates a feature, never a permission.** Turning `bulk-operations`
 * off takes the tick boxes away; it does not make somebody unable to delete a
 * record they may delete. Anything that gates *access* belongs in the role.
 * And the flags screen itself is never gated, or an administrator could
 * switch off their own way back.
 *
 * **An unknown key is off.** A page asking for a flag nobody has declared
 * gets `false`, which fails in the direction that cannot surprise anybody:
 * the new thing stays hidden until somebody turns it on.
 */

import { useAuth } from "@/auth/AuthProvider";

/**
 * The flags this product actually reads, and what each one covers.
 *
 * Declared rather than left as strings scattered through the pages, for the
 * same reason the widget kinds are: this is the list somebody consults when
 * they want to know whether a flag *does* anything, and a key typed at one
 * call site is a key nobody can find again.
 */
export const FEATURES = {
  /** The nested condition builder behind `/explore`'s Advanced button. */
  advancedSearch: "advanced-search",
  /** `/dashboards` — composing your own layouts. */
  dashboardBuilder: "dashboard-builder",
  /** Tick boxes and the bulk bar on every list. */
  bulkOperations: "bulk-operations",
  /** The ⌘K palette. */
  commandPalette: "command-palette",
  /** `/kanban` — the drag-and-drop board. */
  kanbanBoard: "kanban-board",
  /** `/import` — the guided CSV import. */
  csvImport: "csv-import",
  /** Saved views on a list. */
  savedViews: "saved-views",
  /** A cron string on a saved report. */
  reportScheduling: "report-scheduling",
} as const;

export type FeatureKey = (typeof FEATURES)[keyof typeof FEATURES];

/**
 * Whether one feature is on for the signed-in reader.
 *
 * Returns `true` while the profile is still loading *only* for nothing —
 * there is no such case: an absent profile means an absent answer, and an
 * absent answer is off. A control that appears and then vanishes as the
 * profile lands is worse than one that appears a moment late.
 */
export function useFeature(key: FeatureKey): boolean {
  const { profile } = useAuth();
  return profile?.features?.includes(key) ?? false;
}

/** Several at once, for a page that gates more than one thing. */
export function useFeatures(): (key: FeatureKey) => boolean {
  const { profile } = useAuth();
  const on = new Set(profile?.features ?? []);
  return (key: FeatureKey) => on.has(key);
}
