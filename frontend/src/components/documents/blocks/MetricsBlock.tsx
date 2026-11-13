import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "antd";

import type { DocumentBlock } from "@/api/reportDocuments";
import { explorerApi } from "@/api/explorer";
import { formatMetric } from "@/entities/EntityChrome";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Refused, Unfinished } from "./shared";

/** A dataset's own declared headline numbers, as a strip. */
export function MetricsBlock({ block }: { block: DocumentBlock }) {
  const entity = block.entity ?? "";
  const insights = useQuery({
    queryKey: queryKeys.entityInsights(entity, undefined, block.filters),
    queryFn: ({ signal }) =>
      explorerApi.insights({ resource_type: entity, filters: block.filters ?? {} }, signal),
    enabled: Boolean(entity),
    staleTime: STALE.minute,
  });

  if (!entity) return <Unfinished what="No dataset chosen yet" />;
  if (insights.isLoading) return <Skeleton active paragraph={{ rows: 2 }} />;
  if (insights.isError) return <Refused error={insights.error} subject={entity} />;

  const wanted = block.metrics ?? [];
  const metrics = (insights.data?.metrics ?? [])
    .filter((metric) => wanted.length === 0 || wanted.includes(metric.key))
    // Four across a page; more and each tile is a column of digits.
    .slice(0, 4);

  if (metrics.length === 0) return <Unfinished what="This dataset declares no numbers" />;

  return (
    <figure className="nu-doc-figure">
      {block.caption && <figcaption className="nu-doc-caption">{block.caption}</figcaption>}
      <div className="nu-doc-metrics">
        {metrics.map((metric) => {
          const shown = formatMetric(metric);
          return (
            <div key={metric.key} className="nu-doc-metric">
              <span className="nu-doc-metric-value">
                {shown.value}
                {shown.unit && <span className="nu-doc-metric-unit">{shown.unit}</span>}
              </span>
              <span className="nu-doc-metric-label">{metric.label}</span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
