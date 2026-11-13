import { useQuery } from "@tanstack/react-query";
import { Skeleton, Table, Typography } from "antd";

import { panelFor } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import type { DashboardWidget } from "@/api/dashboards";
import { reportsApi } from "@/api/reports";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";
import { Fit } from "../Fit";

const { Text } = Typography;

/**
 * A saved report, drawn as the report itself says it should be.
 *
 * This is what "a saved chart becomes a dashboard widget without being
 * rebuilt" means literally: the widget names the report, running it takes the
 * *stored definition* through the same compiler the chart builder previewed
 * with, and the picture is the one the report chose. Copying the question into
 * the widget's own config would be a second definition that drifts the first
 * time either is edited.
 */
export function ReportBody({ widget, period }: { widget: DashboardWidget; period: string }) {
  const reportId = widget.config.report_id ?? "";
  const run = useQuery({
    queryKey: queryKeys.reportRun(reportId, period),
    queryFn: ({ signal }) => reportsApi.run(reportId, { period }, signal),
    enabled: Boolean(reportId),
    staleTime: STALE.short,
  });

  if (!reportId) {
    return <EmptyState compact title="No report chosen" />;
  }
  if (run.isLoading) return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  if (run.isError) return <WidgetError error={run.error} entity="" />;

  const drawn = (run.data?.report.visualization ?? "bar") as ChartKind;
  // `table` is the one visualization that is not a chart: a saved analysis
  // read as rows. Drawn as rows, then, rather than forced into a bar chart.
  if (drawn === ("table" as ChartKind)) {
    const rows = run.data?.result.rows ?? [];
    const measure = run.data?.result.measures[0];
    return (
      <Table
        size="small"
        rowKey={(row) => row.keys.join("/")}
        pagination={false}
        dataSource={rows}
        columns={[
          {
            title: run.data?.result.dimensions[0]?.label ?? "Group",
            render: (_value, row) => <Text ellipsis>{row.keys.join(" · ")}</Text>,
          },
          {
            title: measure?.label ?? "Value",
            align: "right",
            width: 110,
            render: (_value, row) =>
              Number(row.values[measure?.key ?? ""] ?? 0).toLocaleString(),
          },
        ]}
      />
    );
  }

  return <Fit guess={160}>{(height) => <ChartPreview panel={panelFor(run.data?.result, drawn)} height={height} />}</Fit>;
}
