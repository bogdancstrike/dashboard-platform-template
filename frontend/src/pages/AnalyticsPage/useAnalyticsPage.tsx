/** What the page reads, what it keeps in the address, and what it derives. */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { analysisApi, type AnalysisMeasure, type AnalysisRequest } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { withOrigin } from "@/entities/drilldown";
import { usePageCommands } from "@/commands/CommandContext";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

import { useAnalysis, secondDimension } from "./model";

/** The page's state, queries and actions. */
export function useAnalyticsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The router's location rather than the window's: under a MemoryRouter they
  // are different addresses, and the window's is the wrong one.
  const location = useLocation();

  const catalogue = useQuery({
    queryKey: queryKeys.analysisCatalogue(),
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: STALE.long,
  });

  const datasets = catalogue.data?.datasets ?? [];
  const resourceKey = params.get("resource") ?? datasets[0]?.key ?? "";
  const dataset = datasets.find((item) => item.key === resourceKey);
  const period = params.get("period") ?? "last_90_days";
  const granularity = params.get("grain") ?? "month";
  // The first *closed vocabulary* (status, priority…) rather than the first
  // column: tasks opened grouped by Reference — one bar per record, 320 of
  // them folded into "Other" (audit A).
  const groupBy =
    params.get("group") ??
    (dataset?.dimensions.find((item) => item.kind === "enum") ?? dataset?.dimensions[0])?.name ??
    "";
  const measureName = params.get("measure") ?? "";
  const kind = (params.get("chart") ?? "bar") as ChartKind;

  const set = (changes: Record<string, string | null>) =>
    setParams((current) => applyParamChanges(current, changes), { replace: true });

  /**
   * What the page measures.
   *
   * The dataset's first numeric column unless the reader chose another, plus
   * the row count — which is the one measure every dataset can answer and the
   * one a reader falls back to when a sum makes no sense.
   */
  const measures = useMemo<AnalysisMeasure[]>(() => {
    const chosen = measureName || dataset?.measures[0]?.name;
    return chosen
      ? [{ aggregation: "count" }, { aggregation: "sum", field: chosen }]
      : [{ aggregation: "count" }];
  }, [measureName, dataset]);

  const base: AnalysisRequest | null = dataset
    ? { resource_type: dataset.key, measures, period }
    : null;

  const headline = useAnalysis("headline", base);
  const trend = useAnalysis(
    "trend",
    base && dataset?.default_date
      ? { ...base, dimensions: [{ field: dataset.default_date, granularity }] }
      : null,
  );
  const breakdown = useAnalysis(
    "breakdown",
    base && groupBy ? { ...base, dimensions: [groupBy], limit: 12 } : null,
  );
  const stackBy = secondDimension(dataset?.dimensions ?? [], groupBy);
  const composition = useAnalysis(
    "composition",
    base && groupBy && stackBy ? { ...base, dimensions: [groupBy, stackBy], limit: 40 } : null,
  );

  usePageCommands("analytics", [
    {
      id: "analytics.records",
      label: "Open these records in Data Explorer",
      keywords: "explore list rows",
      run: () => navigate(`/explore?resource=${resourceKey}`),
    },
    {
      id: "analytics.year",
      label: "Widen the period to a year",
      keywords: "period range",
      run: () => set({ period: "last_365_days" }),
    },
  ]);

  /** This page's own address, from the router rather than the window. */
  const here = () => `${location.pathname}${location.search}`;

  /** Where a clicked value goes: the records behind it, already filtered (§44). */
  const drillInto = (field: string) => (value: string) => {
    if (!dataset || value === "Other" || value === "Not set") return;
    // With the analysis's own address attached, so the list can offer the way
    // back to the question that sent the reader there (§44).
    navigate(withOrigin(`${dataset.path}?f.${field}=${encodeURIComponent(value)}`, here()));
  };

  return {
    navigate,
    catalogue,
    datasets,
    resourceKey,
    dataset,
    period,
    granularity,
    groupBy,
    measureName,
    kind,
    set,
    headline,
    trend,
    breakdown,
    composition,
    drillInto,
  };
}

export type AnalyticsPageData = ReturnType<typeof useAnalyticsPage>;
