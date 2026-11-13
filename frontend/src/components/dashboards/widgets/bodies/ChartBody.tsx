import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";

import { analysisApi, panelFor, type AnalysisCatalogue } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import type { DashboardWidget } from "@/api/dashboards";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";
import { Fit } from "../Fit";

/** A grouped analysis, drawn by the renderer every chart in the product uses. */
export function ChartBody({
  widget,
  dataset,
  period,
  kind,
}: {
  widget: DashboardWidget;
  dataset: AnalysisCatalogue["datasets"][number] | undefined;
  period: string;
  kind: ChartKind;
}) {
  const config = widget.config;
  const overTime = kind === "line" || kind === "area";
  // The dataset says what it is worth grouping by; a widget that named nothing
  // takes that rather than a field this file picked.
  const group =
    config.dimension ||
    (overTime ? dataset?.default_date : undefined) ||
    dataset?.dimensions[0]?.name ||
    "";
  const granularity = config.granularity || (overTime ? "month" : "");
  const stack = config.stack || (kind === "heatmap" ? dataset?.dimensions[1]?.name : "") || "";

  const request = {
    resource_type: config.entity ?? "",
    dimensions: [
      ...(group ? [{ field: group, granularity }] : []),
      ...(stack ? [{ field: stack, granularity: "" }] : []),
    ],
    measures: [
      config.aggregation && config.aggregation !== "count" && config.measure
        ? {
            aggregation: config.aggregation as "sum" | "avg" | "min" | "max",
            field: config.measure,
          }
        : { aggregation: "count" as const },
    ],
    filters: config.filters ?? {},
    period,
  };

  const analysis = useQuery({
    queryKey: queryKeys.analysis("widget", widget.id, request),
    queryFn: ({ signal }) => analysisApi.run(request, signal),
    enabled: Boolean(config.entity && group),
    staleTime: STALE.short,
  });

  if (!config.entity || !group) {
    return (
      <EmptyState compact title="This widget has nothing to group by yet" />
    );
  }
  if (analysis.isLoading) return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  if (analysis.isError) {
    return <WidgetError error={analysis.error} entity={config.entity} />;
  }
  if ((analysis.data?.rows.length ?? 0) === 0) {
    return <EmptyState compact title="Nothing in this period" />;
  }

  return <Fit guess={160}>{(height) => <ChartPreview panel={panelFor(analysis.data, kind)} height={height} />}</Fit>;
}
