/**
 * What each block of a report document is, and what it looks like on paper
 * (§28).
 *
 * Split from the page for the same reason `WidgetBody` is split from
 * `WidgetCard`: this follows the *endpoints that answer each block*, and the
 * builder around it follows the layout. One file that did both would change
 * for two reasons.
 *
 * **The preview is the document, not an impression of it.** A `REPORT` block
 * runs the saved report through the same compiler the chart builder previews
 * with; a `TABLE` block runs the explorer query every list uses; a `METRICS`
 * block reads the dataset's declared insights. The server resolves the same
 * three questions when it renders the file, which is what makes "what you see
 * is what you export" true rather than aspirational.
 *
 * **A chart hands back its own PNG.** There is no chart engine on the server,
 * so the export carries the picture this component already drew. The instance
 * is registered by block id when the chart is ready and unregistered when it
 * goes; the builder reads the register at the moment somebody presses Export.
 */

import { useQuery } from "@tanstack/react-query";
import { Skeleton, Table, Typography } from "antd";

import { ApiError } from "@/api/client";
import { analysisApi, panelFor } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import type { DocumentBlock } from "@/api/reportDocuments";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { reportsApi } from "@/api/reports";
import { ChartPreview } from "@/components/charts/ChartPreview";
import { formatMetric } from "@/entities/EntityChrome";
import { asText } from "@/lib/text";
import { EmptyState } from "@/components/EmptyState";

const { Text, Title, Paragraph } = Typography;

/** A chart that has been drawn, and can be asked for its own image. */
export type Capturable = { getDataURL: (options?: object) => string } | null;

/** Rows a table block previews. The server draws up to its own limit. */
const PREVIEW_ROWS = 8;

export function BlockPreview({
  block,
  resources,
  onChart,
}: {
  block: DocumentBlock;
  resources: ExplorerResource[];
  /** Register the drawn chart against this block, for the export. */
  onChart: (id: string, chart: Capturable) => void;
}) {
  switch (block.kind) {
    case "HEADING":
      return (
        <Title level={(block.level ?? 2) as 1 | 2 | 3} className="nu-doc-heading">
          {block.text || "Untitled heading"}
        </Title>
      );
    case "TEXT":
      return (
        <Paragraph className="nu-doc-text">
          {block.text || (
            <Text type="secondary" italic>
              Empty paragraph — write something, or remove the block.
            </Text>
          )}
        </Paragraph>
      );
    case "DIVIDER":
      return <hr className="nu-doc-rule" />;
    case "SPACER":
      return <div className={`nu-doc-spacer is-${block.size ?? "medium"}`} aria-hidden />;
    case "PAGE_BREAK":
      // Drawn as a marked break rather than as an actual new sheet: the
      // preview is a continuous column, and a reader needs to know a break is
      // *there* far more than they need the scroll to jump.
      return (
        <div className="nu-doc-break" aria-label="Page break">
          <span>page break</span>
        </div>
      );
    case "CHART":
      return <ChartBlock block={block} onChart={onChart} />;
    case "REPORT":
      return <ReportBlock block={block} onChart={onChart} />;
    case "TABLE":
      return <TableBlock block={block} resources={resources} />;
    case "METRICS":
      return <MetricsBlock block={block} />;
    default:
      return null;
  }
}

/**
 * A chart the block composed itself.
 *
 * The same compiler the chart builder previews with and the same one the
 * server resolves this block through when it writes the file — so the picture
 * in the preview, the picture in the PDF and the picture on `/charts/builder`
 * are three renderings of one answer rather than three answers.
 */
function ChartBlock({
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
    queryKey: ["analysis", "document", block.id, request],
    queryFn: ({ signal }) => analysisApi.run(request, signal),
    enabled: Boolean(entity && block.dimension),
    staleTime: 60_000,
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

/** A saved report, drawn the way the report itself says it should be. */
function ReportBlock({
  block,
  onChart,
}: {
  block: DocumentBlock;
  onChart: (id: string, chart: Capturable) => void;
}) {
  const reportId = block.report_id ?? "";
  const run = useQuery({
    queryKey: ["report-run", reportId, ""],
    queryFn: ({ signal }) => reportsApi.run(reportId, {}, signal),
    enabled: Boolean(reportId),
    staleTime: 60_000,
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

/** Rows of a dataset, through the query every list in the product uses. */
function TableBlock({
  block,
  resources,
}: {
  block: DocumentBlock;
  resources: ExplorerResource[];
}) {
  const entity = block.entity ?? "";
  const resource = resources.find((item) => item.key === entity);
  const columns = block.columns?.length ? block.columns : resource?.default_columns.slice(0, 5) ?? [];

  const request = {
    resource_type: entity,
    filters: block.filters ?? {},
    columns,
    sort: block.sort || "",
    order: block.order ?? "desc",
    page: 1,
    page_size: Math.min(block.limit ?? 20, PREVIEW_ROWS),
  };

  const rows = useQuery({
    queryKey: ["entity-rows", request],
    queryFn: ({ signal }) => explorerApi.query(request, signal),
    enabled: Boolean(entity),
    staleTime: 60_000,
  });

  if (!entity) return <Unfinished what="No dataset chosen yet" />;
  if (rows.isLoading) return <Skeleton active paragraph={{ rows: 4 }} />;
  if (rows.isError) return <Refused error={rows.error} subject={entity} />;

  const items = rows.data?.items ?? [];
  if (items.length === 0) return <Unfinished what="Nothing matched this block" />;
  const fields = rows.data?.fields ?? [];

  return (
    <figure className="nu-doc-figure">
      {block.caption && <figcaption className="nu-doc-caption">{block.caption}</figcaption>}
      <Table
        size="small"
        className="nu-doc-table"
        rowKey="id"
        pagination={false}
        dataSource={items}
        columns={(rows.data?.columns ?? columns).map((column) => ({
          title: fields.find((field) => field.name === column)?.label ?? column,
          dataIndex: column,
          ellipsis: true,
          render: (value: unknown) => asText(value) || "—",
        }))}
      />
      <Text type="secondary" className="nu-doc-note">
        {(block.limit ?? 20).toLocaleString()} rows in the export, of{" "}
        {(rows.data?.total ?? 0).toLocaleString()} matching.
      </Text>
    </figure>
  );
}

/** A dataset's own declared headline numbers, as a strip. */
function MetricsBlock({ block }: { block: DocumentBlock }) {
  const entity = block.entity ?? "";
  const insights = useQuery({
    queryKey: ["entity-insights", entity, undefined, block.filters],
    queryFn: ({ signal }) =>
      explorerApi.insights({ resource_type: entity, filters: block.filters ?? {} }, signal),
    enabled: Boolean(entity),
    staleTime: 60_000,
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

/**
 * A block that is not finished yet.
 *
 * Distinguished from one that is broken, because only the second is worth an
 * error: the composer adds blocks by *kind* and they are filled in afterwards,
 * so "no dataset chosen" is a normal state on the way to a document (§34).
 */
function Unfinished({ what }: { what: string }) {
  return (
    <div className="nu-doc-unfinished">
      <EmptyState compact title={<Text type="secondary">{what}</Text>} />
    </div>
  );
}

/**
 * Why one block cannot be drawn, in place and in the document's own flow.
 *
 * The server renders the same situation as a line of text in the exported
 * file rather than failing the whole export, and the preview matches: a
 * document with one honest gap in it beats an export that refuses at the
 * moment somebody is about to send it (§34, §76).
 */
function Refused({ error, subject }: { error: Error; subject: string }) {
  const api = error instanceof ApiError ? error : null;
  return (
    <p className="nu-doc-refused">
      [
      {api?.isForbidden
        ? `your role does not include ${subject}`
        : (api?.message ?? `${subject} could not be read`)}
      ]
    </p>
  );
}
