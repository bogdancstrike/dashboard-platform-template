import { useQuery } from "@tanstack/react-query";
import { Skeleton, Typography } from "antd";
import { Link } from "react-router-dom";

import type { DashboardWidget } from "@/api/dashboards";
import { explorerApi } from "@/api/explorer";
import { formatMetric } from "@/entities/EntityChrome";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";

const { Text } = Typography;

/**
 * Every number a dataset declares about itself, the way `/analytics` opens.
 *
 * A `KPI` widget is one figure; this is the strip — and the difference matters
 * because the strip is what a dataset's headline actually *is*. Four KPI
 * widgets pointed at one dataset is four requests for one answer, four cards
 * to keep aligned, and four titles somebody has to write.
 *
 * Each tile is a link that reproduces the number: the metric declares the
 * filter that arrives at it, so pressing "12 overdue" opens the twelve rather
 * than leaving somebody to reconstruct the question (§44).
 */
export function MetricStripBody({ widget }: { widget: DashboardWidget }) {
  const entity = widget.config.entity ?? "";
  const insights = useQuery({
    queryKey: queryKeys.entityInsights(entity, undefined, widget.config.filters),
    queryFn: ({ signal }) =>
      explorerApi.insights({ resource_type: entity, filters: widget.config.filters ?? {} }, signal),
    enabled: Boolean(entity),
    staleTime: STALE.short,
  });

  if (insights.isLoading) return <Skeleton active title={false} paragraph={{ rows: 2 }} />;
  if (insights.isError) return <WidgetError error={insights.error} entity={entity} />;

  const metrics = insights.data?.metrics ?? [];
  if (metrics.length === 0) {
    return <EmptyState compact title="This dataset declares no metrics" />;
  }

  return (
    <div className="nu-widget-strip">
      {metrics.slice(0, 6).map((metric) => {
        const shown = formatMetric(metric);
        const filter = new URLSearchParams({ resource: entity });
        for (const [key, values] of Object.entries(metric.filter ?? {})) {
          for (const value of values) filter.append(`f.${key}`, value);
        }
        return (
          <Link
            key={metric.key}
            to={`/explore?${filter.toString()}`}
            className="nu-widget-strip-tile"
            title={metric.hint}
          >
            <span className="nu-widget-strip-value">
              {shown.value}
              {shown.unit && <span className="nu-widget-metric-unit">{shown.unit}</span>}
            </span>
            <Text type="secondary" ellipsis>
              {metric.label}
            </Text>
          </Link>
        );
      })}
    </div>
  );
}
