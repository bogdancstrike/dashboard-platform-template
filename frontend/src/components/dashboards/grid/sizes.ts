/** How big a widget may be: the grid's row height, each kind's starting and smallest size, and the one-press presets. */

import type { DashboardWidget } from "@/api/dashboards";

/** One grid row, in pixels. Small enough that a KPI tile is one row. */
export const ROW_HEIGHT = 96;
export const GUTTER: [number, number] = [12, 12];

/**
 * The size the server gives a new widget of each kind.
 *
 * A *mirror* of `DEFAULT_SIZES` in `services/dashboards.py`, and deliberately
 * only used for the preview — the server still decides, so the two disagreeing
 * costs a slightly wrong picture rather than a wrong layout. It is here at all
 * because a preview drawn at some rectangle chosen to look good is a preview
 * that flatters every kind equally, and the useful thing to know before adding
 * a card is whether it will be a strip or a panel.
 */
export const PREVIEW_SIZES: Record<DashboardWidget["kind"], { w: number; h: number }> = {
  KPI: { w: 3, h: 1 },
  GAUGE: { w: 3, h: 2 },
  ANALYTICS: { w: 6, h: 1 },
  CHART: { w: 6, h: 2 },
  LINE_CHART: { w: 6, h: 2 },
  AREA_CHART: { w: 6, h: 2 },
  BAR_CHART: { w: 6, h: 2 },
  PIE_CHART: { w: 4, h: 2 },
  HEATMAP: { w: 6, h: 2 },
  MAP: { w: 6, h: 3 },
  LIST: { w: 4, h: 2 },
  TABLE: { w: 6, h: 2 },
  ALERTS: { w: 4, h: 2 },
  ACTIVITY: { w: 4, h: 2 },
  REPORT: { w: 6, h: 2 },
  SEARCH: { w: 4, h: 2 },
  INSIGHT: { w: 6, h: 4 },
  TASKS: { w: 6, h: 3 },
  MAIL: { w: 4, h: 3 },
  FILES: { w: 4, h: 2 },
  NOTIFICATIONS: { w: 4, h: 2 },
  PROJECTS: { w: 6, h: 3 },
  ANNOUNCEMENTS: { w: 4, h: 2 },
  EXPLORER: { w: 4, h: 2 },
  RELATIONSHIPS: { w: 4, h: 2 },
  FAVORITES: { w: 3, h: 2 },
  CALENDAR: { w: 4, h: 3 },
};

/** The smallest a widget may be, per kind — a chart in one column is a line. */
export const MINIMUMS: Partial<Record<DashboardWidget["kind"], { w: number; h: number }>> = {
  KPI: { w: 2, h: 1 },
  GAUGE: { w: 2, h: 2 },
  ANALYTICS: { w: 3, h: 1 },
  CHART: { w: 3, h: 2 },
  LINE_CHART: { w: 3, h: 2 },
  AREA_CHART: { w: 3, h: 2 },
  BAR_CHART: { w: 3, h: 2 },
  PIE_CHART: { w: 3, h: 2 },
  HEATMAP: { w: 4, h: 2 },
  MAP: { w: 4, h: 3 },
  TABLE: { w: 4, h: 2 },
  REPORT: { w: 3, h: 2 },
  SEARCH: { w: 4, h: 2 },
  // The modules are rows of text. Narrower than this and every line ellipses
  // to three words, which is a card that costs space and answers nothing.
  TASKS: { w: 3, h: 2 },
  PROJECTS: { w: 3, h: 2 },
  MAIL: { w: 3, h: 2 },
  FILES: { w: 3, h: 2 },
  NOTIFICATIONS: { w: 3, h: 2 },
  ANNOUNCEMENTS: { w: 3, h: 2 },
  EXPLORER: { w: 3, h: 2 },
  RELATIONSHIPS: { w: 3, h: 2 },
  FAVORITES: { w: 2, h: 2 },
  CALENDAR: { w: 3, h: 2 },
};

export const MINIMUM = { w: 2, h: 1 };

/** The tallest a widget may be. Matches `MAX_HEIGHT` on the server. */
export const MAX_ROWS = 8;

/**
 * The sizes a widget can be set to in one press.
 *
 * Dragging a corner is how somebody arrives at *a* size; these are how they
 * arrive at the size they meant. "Half width" beside another half-width card
 * is the commonest layout on any dashboard, and reaching it by dragging until
 * the number reads six is worse than pressing "Half".
 *
 * Widths are fractions of the grid so they stay right whatever the column
 * count is, and each is clamped to the kind's own minimum by the caller.
 */
export const SIZE_PRESETS: { key: string; label: string; fraction: number; rows: number }[] = [
  { key: "quarter", label: "Quarter width", fraction: 1 / 4, rows: 2 },
  { key: "third", label: "A third", fraction: 1 / 3, rows: 2 },
  { key: "half", label: "Half width", fraction: 1 / 2, rows: 2 },
  { key: "full", label: "Full width", fraction: 1, rows: 3 },
];

/** The smallest this kind may be drawn, for a caller clamping a preset. */
export function minimumFor(kind: DashboardWidget["kind"]): { w: number; h: number } {
  return MINIMUMS[kind] ?? MINIMUM;
}
