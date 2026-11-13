import { useQuery } from "@tanstack/react-query";
import { Segmented, Select, Space } from "antd";

import type { DocBlock } from "@/api/docs";
import { explorerApi } from "@/api/explorer";
import { reportsApi } from "@/api/reports";

import { STALE, queryKeys } from "@/lib/queryKeys";

export const CHARTS = [
  { value: "bar", label: "Bar" },
  { value: "line", label: "Line" },
  { value: "pie", label: "Pie" },
  { value: "area", label: "Area" },
];

export function ChartSettings({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const catalogue = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.long,
  });
  const datasets = catalogue.data?.items ?? [];
  const dataset = datasets.find((item) => item.key === block.entity);
  const groupable = (dataset?.fields ?? []).filter(
    (field) => field.facet || field.kind === "datetime" || field.kind === "enum",
  );
  return (
    <Space wrap className="nx-dc-settings">
      <Select
        aria-label="Dataset"
        placeholder="Dataset"
        style={{ minWidth: 160 }}
        loading={catalogue.isLoading}
        value={block.entity || undefined}
        options={datasets.map((item) => ({ value: item.key, label: item.label }))}
        onChange={(entity: string) => onChange({ ...block, entity, dimension: undefined })}
      />
      <Select
        aria-label="Group by"
        placeholder="Group by"
        style={{ minWidth: 160 }}
        disabled={!dataset}
        value={block.dimension || undefined}
        options={groupable.map((field) => ({ value: field.name, label: field.label }))}
        onChange={(dimension: string) =>
          onChange({ ...block, dimension, granularity: dataset?.fields.find((f) => f.name === dimension)?.kind === "datetime" ? "month" : "" })
        }
      />
      <Segmented
        aria-label="Chart type"
        value={block.chart ?? "bar"}
        options={CHARTS}
        onChange={(chart) => onChange({ ...block, chart: String(chart) })}
      />
    </Space>
  );
}

export function ReportSettings({ block, onChange }: { block: DocBlock; onChange: (next: DocBlock) => void }) {
  const reports = useQuery({ queryKey: queryKeys.reports(), queryFn: ({ signal }) => reportsApi.list(signal), staleTime: STALE.minute });
  return (
    <Space wrap className="nx-dc-settings">
      <Select
        aria-label="Saved report"
        placeholder="Pick a saved report"
        showSearch
        optionFilterProp="label"
        style={{ minWidth: 240 }}
        loading={reports.isLoading}
        value={block.report_id || undefined}
        options={(reports.data?.items ?? []).map((item) => ({ value: item.id, label: item.name }))}
        onChange={(report_id: string) => onChange({ ...block, report_id })}
      />
      <Segmented
        aria-label="Show"
        value={block.show ?? "chart"}
        options={[
          { value: "chart", label: "Chart" },
          { value: "table", label: "Numbers" },
          { value: "both", label: "Both" },
        ]}
        onChange={(show) => onChange({ ...block, show: show as DocBlock["show"] })}
      />
    </Space>
  );
}
