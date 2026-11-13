import { useQuery } from "@tanstack/react-query";
import { Skeleton, Typography } from "antd";

import type { DashboardWidget } from "@/api/dashboards";
import { explorerApi } from "@/api/explorer";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { formatMetric } from "@/entities/EntityChrome";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";
import { Fit } from "../Fit";

const { Text } = Typography;

/** A headline number from the dataset's own declared metrics. */
export function MetricBody({ widget, gauge }: { widget: DashboardWidget; gauge: boolean }) {
  const entity = widget.config.entity ?? "";
  const insights = useQuery({
    queryKey: queryKeys.entityInsights(entity, undefined, widget.config.filters),
    queryFn: ({ signal }) =>
      explorerApi.insights(
        { resource_type: entity, filters: widget.config.filters ?? {} },
        signal,
      ),
    enabled: Boolean(entity),
    staleTime: STALE.short,
  });

  if (insights.isLoading) return <Skeleton active title={false} paragraph={{ rows: 2 }} />;
  if (insights.isError) return <WidgetError error={insights.error} entity={entity} />;

  const metrics = insights.data?.metrics ?? [];
  // The metric named, or the dataset's first declared one. A widget saved
  // before a metric was renamed still shows a number, and the tile is
  // labelled by what it actually resolved to rather than by what it asked for.
  const metric =
    metrics.find((item) => item.key === widget.config.metric) ??
    (gauge ? metrics.find((item) => item.format === "percent") : undefined) ??
    metrics[0];

  if (!metric) {
    return <EmptyState compact title="No metric to show" />;
  }

  if (gauge) {
    return (
      <Fit guess={130}>
        {(height) => (
          <ChartPreview
            panel={{
              kind: "gauge",
              title: metric.label,
              series: [{ name: metric.label, value: metric.value }],
            }}
            height={height}
          />
        )}
      </Fit>
    );
  }

  const shown = formatMetric(metric);
  return (
    // Not `StatCard`: that draws its own card, and a card inside a widget card
    // is a border nobody asked for. The number, its unit and what it is — the
    // widget's own title already says which dataset.
    <div className="nu-widget-metric">
      <span className="nu-widget-metric-value">
        {shown.value}
        {shown.unit && <span className="nu-widget-metric-unit">{shown.unit}</span>}
      </span>
      <Text type="secondary">{metric.label}</Text>
    </div>
  );
}
