/**
 * The question an analysis screen is composing, as it lives in the URL
 * (§28, §44, §69, §72).
 *
 * Three screens ask the same thing in different clothes — the analytics
 * workspace, the report builder and the chart builder — and all three carry it
 * in the address bar so it can be pasted, bookmarked and handed on. "Save as a
 * report" on the workspace works by *navigating*, which only holds together if
 * the three agree on what `group`, `grain` and `agg` mean.
 *
 * Written down once here rather than three times in three page components,
 * because the failure mode is silent: a fourth screen spelling the period key
 * `range` still renders, and the handover just quietly loses the period.
 *
 * This is the *URL* contract only. What the compiler accepts is
 * `services/analysis.py`, and what may be picked is `/api/analysis/catalog`;
 * this module knows neither and must not learn.
 */

import type { AnalysisDimension, AnalysisMeasure } from "@/api/analysis";

/** One analysis question, read off the address bar. */
export interface AnalysisDraft {
  resource: string;
  /** The first grouping, and the bucket it is read in when it is a date. */
  group: string;
  grain: string;
  /** The second grouping — a stack, a treemap's parent, a heatmap's columns. */
  stack: string;
  /** The first measure: an aggregation, and the column it aggregates. */
  aggregation: string;
  measure: string;
  /**
   * The second measure. Only a scatter reads one — it is the y axis to the
   * first's x — so the other screens leave it empty and ignore it.
   */
  aggregation2: string;
  measure2: string;
  period: string;
  chart: string;
}

/** The address-bar key each field is carried under. */
export const DRAFT_KEYS = {
  resource: "resource",
  group: "group",
  grain: "grain",
  stack: "stack",
  aggregation: "agg",
  measure: "measure",
  aggregation2: "agg2",
  measure2: "measure2",
  period: "period",
  chart: "chart",
} as const satisfies Record<keyof AnalysisDraft, string>;

/** Read a draft out of the URL, falling back to what the caller knows. */
export function readDraft(
  params: URLSearchParams,
  defaults: Partial<AnalysisDraft> = {},
): AnalysisDraft {
  const read = (field: keyof AnalysisDraft) =>
    params.get(DRAFT_KEYS[field]) ?? defaults[field] ?? "";

  return {
    resource: read("resource"),
    group: read("group"),
    grain: read("grain"),
    stack: read("stack"),
    aggregation: read("aggregation") || "count",
    measure: read("measure"),
    aggregation2: read("aggregation2"),
    measure2: read("measure2"),
    period: read("period") || "last_90_days",
    chart: read("chart") || "bar",
  };
}

/**
 * The dimensions a draft asks for, in the order the compiler reads them.
 *
 * The granularity rides on the first only: a second date dimension bucketed
 * independently is two time axes on one chart, which is a chart of nothing.
 */
export function draftDimensions(draft: AnalysisDraft): AnalysisDimension[] {
  return [
    ...(draft.group ? [{ field: draft.group, granularity: draft.grain }] : []),
    ...(draft.stack ? [{ field: draft.stack, granularity: "" }] : []),
  ];
}

/**
 * The measures a draft asks for.
 *
 * `count` measures rows and names no column; everything else names one. A
 * second measure is included only when it is complete, so a half-picked
 * scatter previews as a one-measure question rather than as an error.
 */
export function draftMeasures(draft: AnalysisDraft): AnalysisMeasure[] {
  const measures: AnalysisMeasure[] = [measureOf(draft.aggregation, draft.measure)];
  if (draft.aggregation2 && (draft.aggregation2 === "count" || draft.measure2)) {
    measures.push(measureOf(draft.aggregation2, draft.measure2));
  }
  return measures;
}

function measureOf(aggregation: string, field: string): AnalysisMeasure {
  return aggregation === "count"
    ? { aggregation: "count" }
    : { aggregation: aggregation as AnalysisMeasure["aggregation"], field };
}

/** Whether the compiler can be asked this yet. */
export function draftIsRunnable(draft: AnalysisDraft): boolean {
  return Boolean(draft.resource) && (draft.aggregation === "count" || Boolean(draft.measure));
}
