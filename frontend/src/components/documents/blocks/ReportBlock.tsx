import { useQuery } from "@tanstack/react-query";
import { Skeleton, Table, Typography } from "antd";

import { panelFor } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import type { DocumentBlock } from "@/api/reportDocuments";
import { reportsApi } from "@/api/reports";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { PREVIEW_ROWS, Refused, Unfinished, type Capturable } from "./shared";

const { Text } = Typography;

/** A saved report, drawn the way the report itself says it should be. */
export function ReportBlock({
  block,
  onChart,
}: {
  block: DocumentBlock;
  onChart: (id: string, chart: Capturable) => void;
}) {
  const reportId = block.report_id ?? "";
  const run = useQuery({
    queryKey: queryKeys.reportRun(reportId, ""),
    queryFn: ({ signal }) => reportsApi.run(reportId, {}, signal),
    enabled: Boolean(reportId),
    staleTime: STALE.minute,
  });

  if (!reportId) return <Unfinished what="No report chosen yet" />;
  if (run.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (run.isError) return <Refused error={run.error} subject="this report" />;

  const drawn = (run.data?.report.visualization ?? "bar") as ChartKind;
  const result = run.data?.result;
  const show = block.show ?? "both";
  const rows = result?.rows ?? [];
  const measures = result?.measures ?? [];

  return (
    <figure className="nu-doc-figure">
      {block.caption && <figcaption className="nu-doc-caption">{block.caption}</figcaption>}
      {(show === "chart" || show === "both") && (
        <ChartPreview
          panel={panelFor(result, drawn)}
          height={220}
          // Registered by block id, so the export can ask this exact chart for
          // its image. Unregistered on the way out, or a document would carry
          // the picture of a block somebody removed.
          onChart={(chart) => onChart(block.id, chart)}
        />
      )}
      {(show === "table" || show === "both") && rows.length > 0 && (
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
      {rows.length === 0 && <Unfinished what="This report matched nothing" />}
      {rows.length > PREVIEW_ROWS && (
        <Text type="secondary" className="nu-doc-note">
          Showing {PREVIEW_ROWS} of {rows.length} rows — the export carries them all.
        </Text>
      )}
    </figure>
  );
}
