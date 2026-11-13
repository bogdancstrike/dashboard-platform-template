/**
 * API usage per client (§31): requests and errors per day, p50/p95 latency, the
 * busiest routes and the spread of status codes — computed by the server from
 * every keyed request.
 */

import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Segmented, Select, Skeleton, Table, Tag } from "antd";

import { EmptyState } from "@/components/EmptyState";
import { SEMANTIC } from "@/theme/tokens";
import ReactECharts from "echarts-for-react";

import { developersApi, type ApiUsage } from "@/api/developers";
import { ApiError } from "@/api/client";
import { relativeTime } from "@/lib/time";
import { useAppearance } from "@/theme/AppearanceProvider";

type Theme = ReturnType<typeof useAppearance>["chartTheme"];

export function trafficOption(usage: ApiUsage, theme: Theme) {
  return {
    color: [theme.accent, SEMANTIC.danger],
    textStyle: theme.textStyle,
    aria: { enabled: true },
    tooltip: { trigger: "axis" },
    legend: { top: 0, data: ["Requests", "Errors"], textStyle: theme.textStyle },
    grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
    xAxis: { type: "category", data: usage.series.map((row) => row.day.slice(5)), ...theme.categoryAxis },
    yAxis: { type: "value", min: 0, ...theme.valueAxis },
    series: [
      { name: "Requests", type: "bar", data: usage.series.map((row) => row.requests), itemStyle: { borderRadius: [6, 6, 0, 0] } },
      { name: "Errors", type: "line", data: usage.series.map((row) => row.errors), symbolSize: 6 },
    ],
  };
}

export function latencyOption(usage: ApiUsage, theme: Theme) {
  return {
    color: [theme.accent, SEMANTIC.warning],
    textStyle: theme.textStyle,
    aria: { enabled: true },
    tooltip: { trigger: "axis", valueFormatter: (value: unknown) => (typeof value === "number" ? `${value} ms` : "—") },
    legend: { top: 0, data: ["p50", "p95"], textStyle: theme.textStyle },
    grid: { left: 8, right: 12, top: 34, bottom: 6, containLabel: true },
    xAxis: { type: "category", data: usage.series.map((row) => row.day.slice(5)), boundaryGap: false, ...theme.categoryAxis },
    yAxis: { type: "value", name: "ms", min: 0, ...theme.valueAxis },
    series: [
      { name: "p50", type: "line", data: usage.series.map((row) => row.p50_ms), smooth: true, areaStyle: { opacity: 0.1 } },
      { name: "p95", type: "line", data: usage.series.map((row) => row.p95_ms), smooth: true },
    ],
  };
}

export function ApiUsageView({ client, days, onClient, onDays }: {
  client: string;
  days: number;
  onClient: (id: string) => void;
  onDays: (days: number) => void;
}) {
  const { chartTheme } = useAppearance();
  const usage = useQuery({
    queryKey: ["api-usage", client, days],
    queryFn: ({ signal }) => developersApi.usage({ client: client || undefined, days }, signal),
  });
  const everyone = useQuery({
    queryKey: ["api-usage", "", days, "clients"],
    queryFn: ({ signal }) => developersApi.usage({ days }, signal),
    enabled: Boolean(client),
  });
  if (usage.isError) {
    return <Alert type="error" showIcon message={usage.error instanceof ApiError ? usage.error.message : "Usage could not be loaded."} />;
  }
  const data = usage.data;
  const clients = (client ? everyone.data : data)?.clients ?? [];

  return (
    <div className="nx-dev-usage" data-testid="api-usage">
      <div className="nx-dev-toolbar">
        <Select aria-label="API client" className="nx-dev-client" value={client} onChange={onClient} data-testid="usage-client"
          options={[{ value: "", label: "Every client" }, ...clients.map((item) => ({ value: item.id, label: item.name }))]} />
        <Segmented aria-label="Window" value={days} onChange={(value) => onDays(Number(value))}
          options={[{ value: 7, label: "7 days" }, { value: 14, label: "14 days" }, { value: 30, label: "30 days" }]} />
      </div>
      {!data ? <Skeleton active paragraph={{ rows: 8 }} /> : (
        <>
          <div className="nx-dev-kpis">
            <Kpi label="Requests" value={data.totals.requests.toLocaleString()} testId="kpi-requests" />
            <Kpi label="Errors" value={data.totals.errors.toLocaleString()} />
            <Kpi label="Error rate" value={`${(data.totals.error_rate * 100).toFixed(1)}%`} tone={data.totals.error_rate > 0.05 ? "bad" : undefined} />
            <Kpi label="Slowest day p95" value={`${Math.round(data.totals.p95_ms)} ms`} />
          </div>
          <div className="nx-dev-charts">
            <Card size="small" title="Requests and errors per day">
              {data.series.length ? <ReactECharts option={trafficOption(data, chartTheme)} style={{ height: 240 }} notMerge /> : <EmptyState compact title="No requests in this window." />}
            </Card>
            <Card size="small" title="Latency">
              {data.series.length ? <ReactECharts option={latencyOption(data, chartTheme)} style={{ height: 240 }} notMerge /> : <EmptyState compact title="No requests in this window." />}
            </Card>
          </div>
          <div className="nx-dev-charts">
            <Card size="small" title="Busiest endpoints" className="nx-dev-table-card">
              <Table size="small" rowKey={(row) => `${row.method} ${row.path}`} pagination={false} dataSource={data.top_endpoints}
                className="nx-rec-table" data-testid="top-endpoints"
                columns={[
                  { title: "Endpoint", key: "path", render: (_v, row) => <span className="nx-dev-cell"><b>{row.method}</b> <code>{row.path.replace(/^\/platform/, "")}</code></span> },
                  { title: "Requests", dataIndex: "requests", width: 96, align: "end" as const },
                  { title: "Errors", dataIndex: "errors", width: 80, align: "end" as const },
                  { title: "Avg", dataIndex: "avg_ms", width: 86, align: "end" as const, render: (value: number) => `${Math.round(value)} ms` },
                ]} />
            </Card>
            <Card size="small" title="Status codes">
              <div className="nx-dev-codes">
                {data.status_codes.map((row) => (
                  <Tag key={row.code} bordered={false} color={row.code >= 500 ? "error" : row.code >= 400 ? "warning" : "success"}>
                    {row.code} · {row.count}
                  </Tag>
                ))}
              </div>
            </Card>
          </div>
          {!client && (
            <Card size="small" title="Clients" className="nx-dev-table-card">
              <Table size="small" rowKey="id" pagination={false} dataSource={data.clients} className="nx-rec-table" data-testid="usage-clients"
                onRow={(row) => ({ onClick: () => onClient(row.id), style: { cursor: "pointer" } })}
                columns={[
                  { title: "Client", key: "name", render: (_v, row) => <span className="nx-dev-cell"><b>{row.name}</b> <code>{row.client_id}</code></span> },
                  { title: "Requests", dataIndex: "requests", width: 96, align: "end" as const },
                  { title: "Errors", dataIndex: "errors", width: 80, align: "end" as const },
                  { title: "p95", dataIndex: "p95_ms", width: 80, align: "end" as const, render: (value: number) => `${Math.round(value)} ms` },
                  { title: "Last call", dataIndex: "last_used_at", width: 120, render: (value: string | null) => (value ? relativeTime(value) : "—") },
                ]} />
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone, testId }: { label: string; value: string; tone?: "bad"; testId?: string }) {
  return (
    <div className={`nx-dev-kpi${tone ? ` nx-dev-kpi--${tone}` : ""}`} data-testid={testId}>
      <span className="nx-dev-kpi-label">{label}</span>
      <span className="nx-dev-kpi-value">{value}</span>
    </div>
  );
}
