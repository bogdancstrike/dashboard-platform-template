import { useQuery } from "@tanstack/react-query";
import { Skeleton, Table, Typography } from "antd";

import { analysisApi, panelFor } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import type { DocumentBlock } from "@/api/reportDocuments";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { PREVIEW_ROWS, Refused, Unfinished, type Capturable } from "./shared";

const { Text } = Typography;

/**
 * A chart the block composed itself.
 *
 * The same compiler the chart builder previews with and the same one the
 * server resolves this block through when it writes the file — so the picture
 * in the preview, the picture in the PDF and the picture on `/charts/builder`
 * are three renderings of one answer rather than three answers.
 */
export function ChartBlock({
  block,
  onChart,
}: {
  block: DocumentBlock;
  onChart: (id: string, chart: Capturable) => void;
}) {
  const entity = block.entity ?? "";
  const request = {
    resource_type: entity,
    dimensions: [
      { field: block.dimension ?? "", granularity: block.granularity ?? "" },
      ...(block.stack ? [{ field: block.stack, granularity: "" }] : []),
    ],
    measures: [
      block.aggregation && block.aggregation !== "count" && block.measure
        ? {
            aggregation: block.aggregation as "sum" | "avg" | "min" | "max",
            field: block.measure,
          }
        : { aggregation: "count" as const },
    ],
    filters: (block.filters ?? {}) as Record<string, string>,
    period: block.period ?? "",
  };

  const analysis = useQuery({
    queryKey: queryKeys.analysis("document", block.id, request),
    queryFn: ({ signal }) => analysisApi.run(request, signal),
    enabled: Boolean(entity && block.dimension),
    staleTime: STALE.minute,
  });

  if (!entity) return <Unfinished what="No dataset chosen yet" />;
  if (!block.dimension) return <Unfinished what="Nothing to group by yet" />;
  if (analysis.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (analysis.isError) return <Refused error={analysis.error} subject={entity} />;
  const result = analysis.data;
  const rows = result?.rows ?? [];
  const measures = result?.measures ?? [];
  const show = block.show ?? "chart";
  if (rows.length === 0) return <Unfinished what="This chart matched nothing" />;

  return (
    <figure className="nu-doc-figure">
      {block.caption && <figcaption className="nu-doc-caption">{block.caption}</figcaption>}
      {show !== "table" && (
        <ChartPreview
          panel={panelFor(result, (block.chart ?? "bar") as ChartKind)}
          height={220}
          // Registered by block id, so Export can ask this exact chart for its
          // image — the file then carries the picture that was on screen.
          onChart={(chart) => onChart(block.id, chart)}
        />
      )}
      {show !== "chart" && (
        <Table
          size="small"
          className="nu-doc-table"
          rowKey={(row) => row.keys.join("/")}
          pagination={false}
          dataSource={rows.slice(0, PREVIEW_ROWS)}
          columns={[
            {
              title: result?.dimensions[0]?.label ?? "Group",
              render: (_value, row) => row.keys.join(" · "),
            },
            ...measures.map((measure) => ({
              title: measure.label,
              align: "right" as const,
              render: (_value: unknown, row: (typeof rows)[number]) =>
                Number(row.values[measure.key] ?? 0).toLocaleString(),
            })),
          ]}
        />
      )}
      {rows.length > PREVIEW_ROWS && show !== "chart" && (
        <Text type="secondary" className="nu-doc-note">
          Showing {PREVIEW_ROWS} of {rows.length} groups — the export carries them all.
        </Text>
      )}
    </figure>
  );
}
