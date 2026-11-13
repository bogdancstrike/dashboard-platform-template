/** The analytics page's helpers: the breakdown kinds, the analysis query, and how its numbers and labels read. */

import { useQuery } from "@tanstack/react-query";

import { analysisApi, type AnalysisRequest, type AnalysisResult } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { STALE, queryKeys } from "@/lib/queryKeys";

/** How a breakdown of one dimension is drawn, by how many values it has. */
export const BREAKDOWN_KINDS: ChartKind[] = ["bar", "pie", "hbar", "treemap"];

/** One analysis, keyed by the whole request so a changed period refetches. */
export function useAnalysis(name: string, request: AnalysisRequest | null) {
  return useQuery({
    queryKey: queryKeys.analysis(name, request),
    queryFn: ({ signal }) => analysisApi.run(request!, signal),
    enabled: Boolean(request),
    placeholderData: (previous) => previous,
    staleTime: STALE.short,
  });
}

/** The measure a chart draws: the chosen sum where there is one, else the count. */
export function primaryKey(result: AnalysisResult | undefined): string | undefined {
  const sum = result?.measures.find((measure) => measure.aggregation === "sum");
  return (sum ?? result?.measures[0])?.key;
}

/**
 * A dimension to stack the composition chart by.
 *
 * A closed vocabulary only. Stacking by a free-text column means one stack per
 * record — a chart with six hundred colours, which is a list drawn badly. When
 * a dataset has no second vocabulary, the panel is simply not shown.
 */
export function secondDimension(
  dimensions: { name: string; kind: string }[],
  groupBy: string,
): string {
  const usable = dimensions.find(
    (item) => item.name !== groupBy && (item.kind === "enum" || item.kind === "bool"),
  );
  return usable?.name ?? "";
}

export function labelOf(
  dimensions: { name: string; label: string }[] | undefined,
  name: string,
): string {
  return (dimensions ?? []).find((item) => item.name === name)?.label.toLowerCase() ?? name;
}

export function periodLabel(key: string): string {
  if (key === "all_time") return "whole dataset";
  const days = key.replace(/\D/g, "");
  return days ? `last ${days} days` : key.replace(/_/g, " ");
}

/**
 * A measured number, read the way its column is read.
 *
 * Money is money wherever it appears; a count is a count. Derived from the
 * field name rather than carried per panel, because the alternative is a
 * formatting decision repeated in four places.
 */
export function formatMeasure(value: number | null, field: string): string {
  const amount = Number(value ?? 0);
  if (!field) return Math.round(amount).toLocaleString();
  if (/total|value|budget|spent|revenue|price/.test(field)) {
    return amount >= 1_000_000
      ? `€${(amount / 1_000_000).toFixed(1)}M`
      : `€${Math.round(amount).toLocaleString()}`;
  }
  return amount >= 10_000
    ? Math.round(amount).toLocaleString()
    : amount.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
