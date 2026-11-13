import { Form, Select } from "antd";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { WidgetKind } from "@/api/dashboards";

/** Every picture a `CHART` widget may name — the chart builder's own list. */
const WIDGET_CHARTS: { key: string; label: string }[] = [
  { key: "bar", label: "Bars" },
  { key: "hbar", label: "Bars, sideways" },
  { key: "line", label: "Line" },
  { key: "area", label: "Area" },
  { key: "pie", label: "Share" },
  { key: "stacked-bar", label: "Stacked bars" },
  { key: "stacked-area", label: "Stacked area" },
  { key: "multi-line", label: "Several lines" },
  { key: "treemap", label: "Treemap" },
  { key: "scatter", label: "Scatter" },
  { key: "radar", label: "Radar" },
  { key: "funnel", label: "Funnel" },
  { key: "heatmap", label: "Heatmap" },
];

/** Kinds that read one figure or the rows themselves, and so group by nothing. */
const UNGROUPED: WidgetKind[] = ["KPI", "GAUGE", "LIST", "TABLE", "MAP", "ANALYTICS"];

/** The fields a dataset kind asks: which dataset, and the question put to it. */
export function DatasetFields({
  kind,
  datasets,
  dataset,
  periods,
}: {
  kind: WidgetKind;
  datasets: { key: string; label: string }[];
  /** The chosen dataset's catalogue entry, for its measures and dimensions. */
  dataset: AnalysisCatalogue["datasets"][number] | undefined;
  periods: AnalysisCatalogue["periods"];
}) {
  return (
    <>
      <Form.Item name="entity" label="Dataset">
        <Select
          aria-label="Dataset"
          options={datasets.map((item) => ({ value: item.key, label: item.label }))}
        />
      </Form.Item>
      {/* A `CHART` names its own picture — that is the whole of what
                separates it from the five fixed chart kinds. */}
      {kind === "CHART" && (
        <Form.Item
          name="chart"
          label="Draw it as"
          extra="Every shape the chart builder can draw, on a dashboard."
        >
          <Select
            aria-label="Chart kind"
            showSearch
            optionFilterProp="label"
            options={WIDGET_CHARTS.map((item) => ({ value: item.key, label: item.label }))}
          />
        </Form.Item>
      )}
      {(kind === "KPI" || kind === "GAUGE") && (
        <Form.Item
          name="metric"
          label="Which number"
          extra="Leave empty to take the dataset's first declared metric."
        >
          <Select
            aria-label="Metric"
            allowClear
            options={(dataset?.measures ?? []).map((item) => ({
              value: item.name,
              label: item.label,
            }))}
          />
        </Form.Item>
      )}
      {!UNGROUPED.includes(kind) && (
        <Form.Item
          name="dimension"
          label="Group by"
          extra="Leave empty to use the dataset's own default."
        >
          <Select
            aria-label="Group by"
            allowClear
            options={(dataset?.dimensions ?? []).map((item) => ({
              value: item.name,
              label: item.label,
            }))}
          />
        </Form.Item>
      )}
      {(kind === "HEATMAP" || kind === "CHART") && (
        <Form.Item
          name="stack"
          label="And by"
          extra="A second grouping — a stack, or a heatmap's columns."
        >
          <Select
            aria-label="And by"
            allowClear
            options={(dataset?.dimensions ?? []).map((item) => ({
              value: item.name,
              label: item.label,
            }))}
          />
        </Form.Item>
      )}
      <Form.Item
        name="period"
        label="Period"
        extra="Leave empty to follow the dashboard's own period."
      >
        <Select
          aria-label="Period"
          allowClear
          options={[
            { value: "all_time", label: "All time" },
            ...periods.map((item) => ({
              value: item.key,
              label: item.label,
            })),
          ]}
        />
      </Form.Item>
    </>
  );
}
