/** What the page reads, what it keeps in the address, and what it derives. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { analysisApi, panelFor, type AnalysisRequest } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { reportsApi, type ReportInput } from "@/api/reports";
import type { SaveAnalysisValues } from "@/components/analysis/SaveAnalysisDialog";
import { CHART_SHAPES, missingFor } from "@/components/charts/shapes";
import {
  DRAFT_KEYS,
  draftDimensions,
  draftIsRunnable,
  draftMeasures,
  readDraft,
} from "@/entities/analysisDraft";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

import { useBuilderCommands, useChartHeight } from "./builderHooks";

/** The page's state, queries and actions. */
export function useChartBuilderPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [saving, setSaving] = useState(false);

  const editingId = params.get("id") ?? "";
  const [bothThemes, setBothThemes] = useState(false);
  const chartHeight = useChartHeight();

  const catalogue = useQuery({
    queryKey: queryKeys.analysisCatalogue(),
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: STALE.long,
  });

  // The saved chart being edited, when there is one. It is a report, because a
  // chart is a saved analysis and so is a report.
  const existing = useQuery({
    queryKey: queryKeys.report(editingId),
    queryFn: ({ signal }) => reportsApi.get(editingId, signal),
    enabled: Boolean(editingId),
  });

  const datasets = catalogue.data?.datasets ?? [];
  const stored = existing.data;
  const draft = readDraft(params, {
    resource: stored?.resource_type ?? datasets[0]?.key ?? "",
    group: stored?.dimensions[0]?.field ?? "",
    grain: stored?.dimensions[0]?.granularity ?? "",
    stack: stored?.dimensions[1]?.field ?? "",
    aggregation: stored?.metrics[0]?.aggregation ?? "count",
    measure: stored?.metrics[0]?.field ?? "",
    aggregation2: stored?.metrics[1]?.aggregation ?? "",
    measure2: stored?.metrics[1]?.field ?? "",
    period: stored?.period ?? "last_90_days",
    chart: stored?.visualization ?? "bar",
  });

  /**
   * The grouping a fresh chart starts on: the dataset's first *categorical*
   * column (a status, a priority). Grouping by a title or a reference draws
   * one sliver per record, which is a rainbow rather than an answer.
   */
  const sensibleGroup = (resource: string) =>
    datasets.find((item) => item.key === resource)?.dimensions.find((item) => item.kind === "enum")
      ?.name ?? "";

  // A page opened with no question starts on a sensible one rather than on
  // "nothing — one row", which draws a single bar.
  useEffect(() => {
    if (editingId || datasets.length === 0 || params.has("resource")) return;
    const resource = datasets[0]?.key ?? "";
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("resource", resource);
        const group = sensibleGroup(resource);
        if (group) next.set("group", group);
        return next;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, datasets.length]);

  /** How many values to draw before the rest fold into "Other". */
  const top = Number(params.get("top") ?? 10);
  const overTime =
    datasets
      .find((item) => item.key === draft.resource)
      ?.dimensions.find((item) => item.name === draft.group)?.kind === "datetime";

  const setRaw = (changes: Record<string, string | null>) =>
    setParams((current) => applyParamChanges(current, changes), { replace: true });

  /** Choosing a new dataset also chooses a sensible grouping in it. */
  const set = (changes: Record<string, string | null>) => {
    if (changes[DRAFT_KEYS.resource] && !changes[DRAFT_KEYS.group]) {
      const group = sensibleGroup(changes[DRAFT_KEYS.resource] ?? "");
      setRaw({ ...changes, [DRAFT_KEYS.group]: group || null });
      return;
    }
    setRaw(changes);
  };

  const dimensions = draftDimensions(draft);
  const measures = draftMeasures(draft);

  /** What the gallery asks of each kind: how many of each thing there are. */
  const shapeDraft = useMemo(
    () => ({
      dimensions: dimensions.length,
      measures: measures.length,
      overTime: Boolean(draft.grain && draft.group),
    }),
    [dimensions.length, measures.length, draft.grain, draft.group],
  );

  const preview = useQuery({
    queryKey: queryKeys.analysis(
      "chart-builder",
      draft.resource,
      dimensions,
      measures,
      draft.period,
      overTime ? 0 : top,
    ),
    queryFn: ({ signal }) =>
      analysisApi.run(
        {
          resource_type: draft.resource,
          dimensions,
          measures,
          period: draft.period,
          // Over time every bucket is drawn; otherwise the top N, with the
          // rest folded into "Other" by the server so the parts still add up.
          ...(overTime ? {} : { limit: top }),
        } satisfies AnalysisRequest,
        signal,
      ),
    enabled: draftIsRunnable(draft),
    placeholderData: (previous) => previous,
  });

  const chosen = CHART_SHAPES.find((shape) => shape.kind === draft.chart);
  const blocked = chosen ? missingFor(chosen, shapeDraft) : null;
  const panel = panelFor(preview.data, draft.chart as ChartKind);

  const save = useMutation({
    mutationFn: (values: SaveAnalysisValues) => {
      const input: ReportInput = {
        ...values,
        resource_type: draft.resource,
        dimensions,
        metrics: measures,
        period: draft.period,
        visualization: draft.chart,
      };
      return editingId ? reportsApi.update(editingId, input) : reportsApi.create(input);
    },
    onSuccess: (saved) => {
      message.success(editingId ? `${saved.name} saved` : `${saved.name} created`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports() });
      setSaving(false);
      navigate(`/reports?report=${saved.id}`);
    },
  });

  useBuilderCommands(params, draft.resource, setSaving);

  return {
    navigate,
    message,
    params,
    saving,
    setSaving,
    editingId,
    bothThemes,
    setBothThemes,
    chartHeight,
    catalogue,
    existing,
    stored,
    draft,
    top,
    overTime,
    setRaw,
    set,
    measures,
    shapeDraft,
    preview,
    chosen,
    blocked,
    panel,
    save,
  };
}

export type ChartBuilderPageData = ReturnType<typeof useChartBuilderPage>;
