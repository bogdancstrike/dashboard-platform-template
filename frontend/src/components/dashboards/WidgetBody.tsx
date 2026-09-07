/**
 * What one widget shows, fetched from the endpoint that owns the question
 * (§45).
 *
 * No widget computes anything here, and none has an endpoint of its own. A KPI
 * reads the dataset's declared insight metrics, a chart goes through the
 * analysis compiler, a list through the explorer query, and the alert strip and
 * activity feed through the dashboard summary the home page already uses. A
 * dashboard that recomputed any of them would be a second answer to a question
 * the platform has already answered — and the two would drift.
 *
 * Two decisions worth stating.
 *
 * **A widget with no grouping is complete, not broken.** The dataset declares
 * which of its fields is worth grouping by; a chart widget that names none
 * takes that default. Derived from the catalogue rather than invented here, so
 * a dataset whose declaration changes takes its widgets with it.
 *
 * **A widget that cannot be answered says so in place.** Not an empty card and
 * not a spinner that never resolves: which dataset, which permission, and the
 * correlation id (§34, §76). A dashboard is read at a glance, and a panel that
 * fails quietly is a number somebody will quote.
 */

import { useQuery } from "@tanstack/react-query";
import { Alert, Empty, List, Skeleton, Table, Tag, Typography } from "antd";
import { Link } from "react-router-dom";

import { ApiError } from "@/api/client";
import { analysisApi, panelFor, type AnalysisCatalogue } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import { dashboardApi } from "@/api/dashboard";
import type { DashboardWidget } from "@/api/dashboards";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { reportsApi } from "@/api/reports";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { StatusTag } from "@/components/StatusTag";
import { formatMetric } from "@/entities/EntityChrome";
import { asText } from "@/lib/text";
import { relativeTime } from "@/lib/time";
import { knownStatusColor } from "@/theme/tokens";

const { Text } = Typography;

/** Which chart the platform's renderer should draw, per widget kind. */
const CHART_FOR: Partial<Record<DashboardWidget["kind"], ChartKind>> = {
  LINE_CHART: "line",
  AREA_CHART: "area",
  BAR_CHART: "bar",
  PIE_CHART: "pie",
  HEATMAP: "heatmap",
  GAUGE: "gauge",
};

/** Kinds drawn by the chart renderer rather than by a bespoke body. */
const IS_CHART = (kind: DashboardWidget["kind"]) => kind in CHART_FOR && kind !== "GAUGE";

export function WidgetBody({
  widget,
  period,
  catalogue,
  resources,
}: {
  widget: DashboardWidget;
  /** The dashboard's period, which a widget may override. */
  period: string;
  /** What may be grouped and measured, for the defaults a widget omits. */
  catalogue: AnalysisCatalogue | undefined;
  resources: ExplorerResource[];
}) {
  const config = widget.config;
  const entity = config.entity ?? "";
  const dataset = catalogue?.datasets.find((item) => item.key === entity);
  const resource = resources.find((item) => item.key === entity);
  const effectivePeriod = config.period ?? period;

  if (widget.kind === "ALERTS") return <AlertsBody />;
  if (widget.kind === "ACTIVITY") return <ActivityBody />;
  if (widget.kind === "REPORT") return <ReportBody widget={widget} period={effectivePeriod} />;
  if (widget.kind === "SEARCH") return <SearchBody widget={widget} resources={resources} />;
  if (widget.kind === "KPI" || widget.kind === "GAUGE") {
    return <MetricBody widget={widget} gauge={widget.kind === "GAUGE"} />;
  }
  if (widget.kind === "LIST" || widget.kind === "TABLE") {
    return <RowsBody widget={widget} resource={resource} table={widget.kind === "TABLE"} />;
  }
  return (
    <ChartBody
      widget={widget}
      dataset={dataset}
      period={effectivePeriod}
      kind={CHART_FOR[widget.kind] ?? "bar"}
    />
  );
}

/** A headline number from the dataset's own declared metrics. */
function MetricBody({ widget, gauge }: { widget: DashboardWidget; gauge: boolean }) {
  const entity = widget.config.entity ?? "";
  const insights = useQuery({
    queryKey: ["entity-insights", entity, undefined, widget.config.filters],
    queryFn: ({ signal }) =>
      explorerApi.insights(
        { resource_type: entity, filters: widget.config.filters ?? {} },
        signal,
      ),
    enabled: Boolean(entity),
    staleTime: 30_000,
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
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No metric to show" />;
  }

  if (gauge) {
    return (
      <ChartPreview
        panel={{
          kind: "gauge",
          title: metric.label,
          series: [{ name: metric.label, value: metric.value }],
        }}
        height={130}
      />
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

/** A grouped analysis, drawn by the renderer every chart in the product uses. */
function ChartBody({
  widget,
  dataset,
  period,
  kind,
}: {
  widget: DashboardWidget;
  dataset: AnalysisCatalogue["datasets"][number] | undefined;
  period: string;
  kind: ChartKind;
}) {
  const config = widget.config;
  const overTime = kind === "line" || kind === "area";
  // The dataset says what it is worth grouping by; a widget that named nothing
  // takes that rather than a field this file picked.
  const group =
    config.dimension ||
    (overTime ? dataset?.default_date : undefined) ||
    dataset?.dimensions[0]?.name ||
    "";
  const granularity = config.granularity || (overTime ? "month" : "");
  const stack = config.stack || (kind === "heatmap" ? dataset?.dimensions[1]?.name : "") || "";

  const request = {
    resource_type: config.entity ?? "",
    dimensions: [
      ...(group ? [{ field: group, granularity }] : []),
      ...(stack ? [{ field: stack, granularity: "" }] : []),
    ],
    measures: [
      config.aggregation && config.aggregation !== "count" && config.measure
        ? {
            aggregation: config.aggregation as "sum" | "avg" | "min" | "max",
            field: config.measure,
          }
        : { aggregation: "count" as const },
    ],
    filters: config.filters ?? {},
    period,
  };

  const analysis = useQuery({
    queryKey: ["analysis", "widget", widget.id, request],
    queryFn: ({ signal }) => analysisApi.run(request, signal),
    enabled: Boolean(config.entity && group),
    staleTime: 30_000,
  });

  if (!config.entity || !group) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description="This widget has nothing to group by yet"
      />
    );
  }
  if (analysis.isLoading) return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  if (analysis.isError) {
    return <WidgetError error={analysis.error} entity={config.entity} />;
  }
  if ((analysis.data?.rows.length ?? 0) === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing in this period" />;
  }

  return <ChartPreview panel={panelFor(analysis.data, kind)} height={160} />;
}

/** The newest few records of a dataset, as a list or as a table. */
function RowsBody({
  widget,
  resource,
  table,
}: {
  widget: DashboardWidget;
  resource: ExplorerResource | undefined;
  table: boolean;
}) {
  const entity = widget.config.entity ?? "";
  const columns = resource?.default_columns.slice(0, 3) ?? [];
  const request = {
    resource_type: entity,
    filters: widget.config.filters ?? {},
    columns: table ? columns : undefined,
    sort: "updated_at",
    order: "desc" as const,
    page_size: table ? 5 : 6,
  };

  const rows = useQuery({
    queryKey: ["entity-rows", request],
    queryFn: ({ signal }) => explorerApi.query(request, signal),
    enabled: Boolean(entity),
    staleTime: 30_000,
  });

  if (rows.isLoading) return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  if (rows.isError) return <WidgetError error={rows.error} entity={entity} />;

  const items = rows.data?.items ?? [];
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing here yet" />;
  }

  const path = resource?.path ?? "";
  const title = resource?.title_field ?? "";
  const status = resource?.status_field ?? "";

  if (table) {
    return (
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={items}
        columns={columns.map((column) => ({
          title: resource?.fields.find((field) => field.name === column)?.label ?? column,
          dataIndex: column,
          ellipsis: true,
          // `asText`, not `String`: a declared JSON or array column is an
          // object, and `String({})` reads as a bug in the field rather than
          // in the rendering of it.
          render: (value: unknown) =>
            column === status ? (
              <StatusTag status={asText(value)} />
            ) : (
              <Text ellipsis>{asText(value) || "—"}</Text>
            ),
        }))}
      />
    );
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(row) => (
        <List.Item>
          <Link to={`${path}/${row.id}`} className="nu-widget-row">
            <Text ellipsis>{asText(row[title]) || asText(row["id"])}</Text>
            {status && row[status] ? (
              <Tag color={knownStatusColor(asText(row[status]))} bordered={false}>
                {asText(row[status])}
              </Tag>
            ) : null}
          </Link>
        </List.Item>
      )}
    />
  );
}

/** The alert strip the home dashboard already computes. */
function AlertsBody() {
  const alerts = useQuery({
    queryKey: ["dashboard-alerts"],
    queryFn: ({ signal }) => dashboardApi.alerts(signal),
    staleTime: 30_000,
  });

  if (alerts.isLoading) return <Skeleton active title={false} paragraph={{ rows: 3 }} />;
  if (alerts.isError) return <WidgetError error={alerts.error} entity="" />;

  const items = alerts.data?.items ?? [];
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing needs attention" />;
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(alert) => (
        <List.Item>
          <Link to={alert.link} className="nu-widget-row">
            <Tag
              color={
                alert.severity === "CRITICAL"
                  ? "error"
                  : alert.severity === "WARNING"
                    ? "warning"
                    : "processing"
              }
              bordered={false}
            >
              {alert.count}
            </Tag>
            <Text ellipsis>{alert.message}</Text>
          </Link>
        </List.Item>
      )}
    />
  );
}

/** The activity feed, from the same summary the home page reads. */
function ActivityBody() {
  const summary = useQuery({
    queryKey: ["dashboard-summary", "activity"],
    queryFn: ({ signal }) => dashboardApi.summary({ period: "last_7_days" }, signal),
    staleTime: 60_000,
  });

  if (summary.isLoading) return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  if (summary.isError) return <WidgetError error={summary.error} entity="" />;

  const items = (summary.data?.activity ?? []).slice(0, 6);
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing has happened yet" />;
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(entry) => (
        <List.Item>
          <div className="nu-widget-row">
            <Text ellipsis>
              <Text strong>{entry.actor}</Text> {entry.summary}
            </Text>
            <Text type="secondary">{relativeTime(entry.occurred_at)}</Text>
          </div>
        </List.Item>
      )}
    />
  );
}


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
function ReportBody({ widget, period }: { widget: DashboardWidget; period: string }) {
  const reportId = widget.config.report_id ?? "";
  const run = useQuery({
    queryKey: ["report-run", reportId, period],
    queryFn: ({ signal }) => reportsApi.run(reportId, { period }, signal),
    enabled: Boolean(reportId),
    staleTime: 30_000,
  });

  if (!reportId) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No report chosen" />;
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

  return <ChartPreview panel={panelFor(run.data?.result, drawn)} height={160} />;
}

/**
 * A saved search, answered here.
 *
 * The stored question, run through the explorer query every list uses — so the
 * widget shows the same rows the explorer would, in the same order, under the
 * same permissions. What it does not do is re-describe the question: a saved
 * search that is edited takes its widgets with it.
 */
function SearchBody({
  widget,
  resources,
}: {
  widget: DashboardWidget;
  resources: ExplorerResource[];
}) {
  const searchId = widget.config.search_id ?? "";
  const search = useQuery({
    queryKey: ["saved-search", searchId],
    queryFn: ({ signal }) => explorerApi.openSaved(searchId, signal),
    enabled: Boolean(searchId),
    staleTime: 60_000,
  });

  const stored = search.data;
  const rows = useQuery({
    queryKey: ["entity-rows", "saved-search", searchId],
    queryFn: ({ signal }) =>
      explorerApi.query(
        {
          resource_type: stored!.resource_type,
          query_text: stored!.query_text,
          condition_tree: stored!.condition_tree,
          filters: stored!.filters,
          sort: stored!.sort,
          order: stored!.order,
          page_size: 6,
        },
        signal,
      ),
    enabled: Boolean(stored),
    staleTime: 30_000,
  });

  if (!searchId) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No search chosen" />;
  }
  if (search.isLoading || rows.isLoading) {
    return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  }
  if (search.isError) return <WidgetError error={search.error} entity="" />;
  if (rows.isError) return <WidgetError error={rows.error} entity={stored?.resource_type ?? ""} />;

  const resource = resources.find((item) => item.key === stored?.resource_type);
  const items = rows.data?.items ?? [];
  if (items.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing matches it now" />;
  }

  const title = resource?.title_field ?? "";
  const status = resource?.status_field ?? "";
  const path = resource?.path ?? "";

  return (
    <>
      <Text type="secondary" style={{ display: "block", marginBottom: 4, fontSize: 12 }}>
        {rows.data?.total.toLocaleString()} match {stored?.name}
      </Text>
      <List
        size="small"
        dataSource={items}
        renderItem={(row) => (
          <List.Item>
            <Link to={`${path}/${row.id}`} className="nu-widget-row">
              <Text ellipsis>{asText(row[title]) || asText(row["id"])}</Text>
              {status && row[status] ? <StatusTag status={asText(row[status])} /> : null}
            </Link>
          </List.Item>
        )}
      />
    </>
  );
}

/**
 * Why this one card is empty, in place.
 *
 * Named per widget rather than once per page: a dashboard has a dozen panels,
 * and "something went wrong" at the top does not say which of them is the one
 * showing a stale number.
 */
function WidgetError({ error, entity }: { error: Error; entity: string }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <Alert
      type={api?.isForbidden ? "warning" : "error"}
      showIcon
      message={
        api?.isForbidden
          ? `Your role does not include ${entity || "this data"}`
          : (api?.message ?? "This widget could not be loaded")
      }
      description={
        api ? (
          <Text code copyable={{ text: api.correlationId }} style={{ fontSize: 11 }}>
            {api.correlationId}
          </Text>
        ) : undefined
      }
    />
  );
}

export { IS_CHART };
