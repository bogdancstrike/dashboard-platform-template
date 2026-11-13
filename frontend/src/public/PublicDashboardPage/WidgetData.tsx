/**
 * One shared widget's data, drawn by the kind of payload the server sent —
 * a registry from payload type to renderer.
 */
import type { ComponentType } from "react";
import { Table } from "antd";

import { panelFor } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import type { PublicWidgetData } from "@/api/recordsAnalytics";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { EmptyState } from "@/components/EmptyState";
import { StatusTag } from "@/components/StatusTag";
import { formatMetric } from "@/entities/EntityChrome";
import { asText } from "@/lib/text";

type Of<T extends PublicWidgetData["type"]> = Extract<PublicWidgetData, { type: T }>;

function MetricsWidget({ data }: { data: Of<"metrics"> }) {
  if (data.strip) {
    return (
      <div className="nx-ra-strip">
        {data.metrics.map((metric) => {
          const shown = formatMetric(metric as never);
          return <div key={metric.key}><b>{shown.value}{shown.unit}</b><span>{metric.label}</span></div>;
        })}
      </div>
    );
  }
  const metric = data.metrics.find((m) => m.key === data.metric) ?? (data.gauge ? data.metrics.find((m) => m.format === "percent") : undefined) ?? data.metrics[0];
  if (!metric) return <EmptyState compact title="No metric" />;
  if (data.gauge) {
    return <ChartPreview panel={{ kind: "gauge", title: metric.label, series: [{ name: metric.label, value: Number(metric.value ?? 0) }] }} height={140} />;
  }
  const shown = formatMetric(metric as never);
  return <div className="nx-ra-metric"><b>{shown.value}{shown.unit}</b><span>{metric.label}</span></div>;
}

function ChartWidget({ data, kind }: { data: Of<"chart">; kind: string }) {
  if (!data.result.rows.length) return <EmptyState compact title="Nothing in this period" />;
  return <ChartPreview panel={panelFor(data.result, (data.chart || "bar") as ChartKind)} height={kind === "REPORT" ? 200 : 170} />;
}

function RowsWidget({ data }: { data: Of<"rows"> }) {
  if (!data.items.length) return <EmptyState compact title="Nothing here yet" />;
  if (!data.table) {
    return (
      <ul className="nx-ra-rows">
        {data.items.map((row) => (
          <li key={asText(row.id)} className="nx-ra-row" style={{ cursor: "default" }}>
            <div className="nx-ra-row-main"><b>{asText(row[data.title_field]) || asText(row.id)}</b></div>
            {data.status_field && row[data.status_field] ? <StatusTag status={asText(row[data.status_field])} /> : null}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table
      size="small"
      rowKey={(row) => asText(row.id)}
      pagination={false}
      dataSource={data.items}
      columns={data.columns.map((column) => ({
        title: column.label,
        dataIndex: column.name,
        ellipsis: true,
        render: (value: unknown) => (column.name === data.status_field ? <StatusTag status={asText(value)} /> : asText(value) || "—"),
      }))}
    />
  );
}

function MessageWidget({ data }: { data: { message: string } }) {
  return <p className="nx-ra-muted">{data.message}</p>;
}

const RENDERERS: Record<string, ComponentType<{ data: never; kind: string }>> = {
  metrics: MetricsWidget,
  chart: ChartWidget,
  rows: RowsWidget,
  private: MessageWidget,
  empty: MessageWidget,
};

export function WidgetData({ data, kind }: { data: PublicWidgetData; kind: string }) {
  const Renderer = RENDERERS[data.type];
  if (!Renderer) return <p className="nx-ra-muted">This widget could not be drawn: {(data as { message?: string }).message}</p>;
  return <Renderer data={data as never} kind={kind} />;
}
