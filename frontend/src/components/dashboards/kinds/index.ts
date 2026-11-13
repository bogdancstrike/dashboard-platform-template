/**
 * What each widget kind is, in one place (§45).
 *
 * The picker, the configure drawer and the gallery card all need the same
 * facts about a kind — what to call it, what question it answers, what it
 * needs naming, and how to draw it small. Three copies of that list is three
 * places to forget a kind, and the one that forgets it is the one somebody
 * uses.
 *
 * The record is keyed on the whole `WidgetKind` union, so a kind added to the
 * server without being described here fails to compile rather than appearing
 * as a blank card.
 *
 * **A kind belongs to a family, and the families are what a reader browses.**
 * Twenty-six cards in one undifferentiated grid is a wall; the same
 * twenty-six under *Numbers · Charts · Records · Your modules · Saved* is a
 * short list four times. The families are also the honest description of what
 * these are: the first three ask a dataset a question, the fourth puts a page
 * of the product on the grid, and the fifth draws something you already made.
 */

import type { WidgetKind } from "@/api/dashboards";
import { FEATURES, flagForPath, type FeatureKey } from "@/settings/features";

import { CHART_KINDS } from "./charts";
import { MODULE_KINDS } from "./modules";
import { NUMBER_KINDS } from "./numbers";
import { RECORD_KINDS } from "./records";
import { SAVED_KINDS } from "./saved";
import type { KindFamily, KindSpec } from "./spec";

export { FAMILY_LABELS, KIND_FAMILIES, type KindFamily, type KindSpec } from "./spec";

export const KINDS: Record<WidgetKind, KindSpec> = {
  ...NUMBER_KINDS,
  ...CHART_KINDS,
  ...RECORD_KINDS,
  ...MODULE_KINDS,
  ...SAVED_KINDS,
};

/** The kinds in the order a person browses them, family by family. */
export const KIND_ORDER: WidgetKind[] = [
  // Numbers
  "KPI",
  "GAUGE",
  "ANALYTICS",
  // Charts
  "CHART",
  "BAR_CHART",
  "LINE_CHART",
  "AREA_CHART",
  "PIE_CHART",
  "HEATMAP",
  "MAP",
  // Records
  "LIST",
  "TABLE",
  "ALERTS",
  "ACTIVITY",
  // Modules
  "TASKS",
  "PROJECTS",
  "MAIL",
  "CALENDAR",
  "NOTIFICATIONS",
  "ANNOUNCEMENTS",
  "FILES",
  "EXPLORER",
  "RELATIONSHIPS",
  "FAVORITES",
  // Saved
  "REPORT",
  "SEARCH",
  "INSIGHT",
];

/**
 * The feature flag a kind belongs to (§27): the flag of the page it opens,
 * and saved searches for the SEARCH kind (its page is the explorer, which no
 * flag governs). A kind whose flag is off is not offered, and a widget of
 * that kind already on a dashboard says so instead of failing.
 */
export function kindFlag(kind: WidgetKind): FeatureKey | undefined {
  if (kind === "SEARCH") return FEATURES.savedViews;
  const page = KINDS[kind].page;
  return page ? flagForPath(page) : undefined;
}

/** The kinds of one family, in browsing order. */
export function kindsOf(family: KindFamily, available: WidgetKind[]): WidgetKind[] {
  return KIND_ORDER.filter(
    (kind) => KINDS[kind].family === family && available.includes(kind),
  );
}
