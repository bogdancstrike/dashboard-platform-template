import { api } from "./client";

import type { ChartPanel, ChartPoint } from "./dashboard";
import type { FieldKind, QueryNode } from "./explorer";

/**
 * Grouped analysis over any dataset (§2, §28, §44).
 *
 * The analytics workspace, the report builder, the chart builder and the map
 * all ask one question — *group these rows by these columns and measure them
 * this way* — so they share one endpoint. Anything a screen decides for itself
 * here is a place where two screens will eventually disagree about what "last
 * 30 days" meant.
 */

export interface AnalysisDimension {
  field: string;
  /** `day` · `week` · `month` · `quarter` · `year`, for a date. */
  granularity?: string;
}

export interface AnalysisMeasure {
  aggregation: "count" | "sum" | "avg" | "min" | "max";
  field?: string;
}

export interface AnalysisRequest {
  resource_type: string;
  dimensions?: (string | AnalysisDimension)[];
  measures?: AnalysisMeasure[];
  filters?: Record<string, string>;
  condition_tree?: QueryNode | null;
  query_text?: string;
  /** A named period, or an explicit range. */
  period?: string | { key?: string; field?: string; from?: string; to?: string };
  date_field?: string;
  limit?: number;
}

export interface AnalysisRow {
  /** One label per dimension, in declaration order. */
  keys: string[];
  /** Keyed by measure key — `count`, `sum:total`. */
  values: Record<string, number | null>;
}

export interface AnalysisResult {
  resource_type: string;
  resource_label: string;
  path: string;
  dimensions: { field: string; label: string; kind: FieldKind; granularity: string }[];
  measures: {
    key: string;
    label: string;
    aggregation: string;
    field: string;
    format: string;
  }[];
  rows: AnalysisRow[];
  totals: Record<string, number | null>;
  matched: number;
  truncated: boolean;
  /** The collapsed tail, when there was one, so the parts still add up. */
  other: AnalysisRow | null;
  period: { key: string; field: string; from: string | null; to: string | null };
  /** The analysis as a sentence, written from the objects the SQL was built from. */
  description: string;
  generated_at: string;
}

export interface AnalysisCatalogue {
  datasets: {
    key: string;
    label: string;
    description: string;
    path: string;
    dimensions: { name: string; label: string; kind: FieldKind; choices: string[] }[];
    measures: { name: string; label: string }[];
    dates: { name: string; label: string }[];
    default_date: string;
  }[];
  aggregations: { key: string; label: string; format: string }[];
  granularities: string[];
  periods: { key: string; label: string; days: number }[];
}

export const analysisApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<AnalysisCatalogue>("/api/analysis/catalog", { signal }),
  run: (request: AnalysisRequest, signal?: AbortSignal) =>
    api.post<AnalysisResult>("/api/analysis/run", request, { signal }),
};

/**
 * An analysis as a chart panel.
 *
 * The bridge between the analysis contract and the chart vocabulary the
 * platform already themes, so the workspace, the builders and the dashboard
 * draw with one renderer rather than three.
 */
export function panelFor(
  result: AnalysisResult | undefined,
  kind: ChartPanel["kind"],
  measureKey?: string,
  title?: string,
): ChartPanel | undefined {
  if (!result) return undefined;
  const measure = result.measures.find((item) => item.key === measureKey) ?? result.measures[0];
  if (!measure) return undefined;

  const overTime = Boolean(result.dimensions[0]?.granularity);
  const grouped = result.dimensions.length > 1;

  // The collapsed tail is drawn too: a pie whose slices do not add up to the
  // total beside it is a pie nobody reconciles twice.
  const rows = result.other ? [...result.rows, result.other] : result.rows;

  const series: ChartPoint[] = rows.map((row) => ({
    ...(overTime ? { bucket: row.keys[0] } : { name: row.keys[0] }),
    ...(grouped ? { group: row.keys[1] } : {}),
    value: Number(row.values[measure.key] ?? 0),
  }));

  return {
    kind,
    title: title ?? capitalise(result.description),
    series,
    groups: grouped ? [...new Set(rows.map((row) => row.keys[1] ?? ""))] : undefined,
    unit: measure.field.includes("value") || measure.field === "total" || measure.field === "budget"
      ? "currency"
      : undefined,
  };
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
