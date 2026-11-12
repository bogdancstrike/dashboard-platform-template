import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { Progress, Timeline, Typography } from "antd";
import { Link } from "react-router-dom";

import { EmptyState } from "@/components/EmptyState";
import { MiniMarkdown } from "@/components/knowledge/MiniMarkdown";
import { StatusTag } from "@/components/StatusTag";
import { useAppearance } from "@/theme/AppearanceProvider";
import {
  formatValue,
  parseBlocks,
  type ChartNode,
  type ComparisonNode,
  type InsightNode,
  type KpiNode,
  type ListNode,
  type ProgressNode,
  type TableNode,
  type TimelineNode,
} from "./spec";

const { Text } = Typography;

/**
 * An insight, drawn from its bound spec with the registry's components (§43).
 *
 * Every node passes `parseBlocks` first, so an unknown or malformed component
 * is simply absent. A component whose query failed for this viewer shows why
 * in its own place; the rest of the page is unaffected.
 */
export function InsightView({ blocks, compact = false }: { blocks: unknown; compact?: boolean }) {
  const nodes = useMemo(() => parseBlocks(blocks), [blocks]);
  if (!nodes.length) return <EmptyState compact title="Nothing to show" hint="This insight has no components this version can draw." />;
  return (
    <div className={`nx-in-grid${compact ? " is-compact" : ""}`} data-testid="insight-view">
      {nodes.map((node, index) => (
        <Block key={index} node={node} compact={compact} />
      ))}
    </div>
  );
}

function Block({ node, compact }: { node: InsightNode; compact: boolean }) {
  const body = node.error ? (
    <Text type="secondary" className="nx-in-error" data-testid="insight-node-error">
      {node.error}
    </Text>
  ) : (
    <Body node={node} compact={compact} />
  );
  if (node.type === "section") {
    return (
      <section className="nx-in-section nx-in-w-full" data-type="section">
        {node.title && <h3 className="nx-in-section-title">{node.title}</h3>}
        <div className="nx-in-grid">
          {node.blocks.map((child, index) => (
            <Block key={index} node={child} compact={compact} />
          ))}
        </div>
      </section>
    );
  }
  const framed = node.type !== "markdown" && node.type !== "callout";
  return (
    <div
      className={`nx-in-node nx-in-w-${node.width}${framed ? " nx-in-card" : ""} nx-in-${node.type}`}
      data-type={node.type}
      data-testid="insight-node"
    >
      {node.title && node.type !== "kpi" && node.type !== "callout" && <div className="nx-in-title">{node.title}</div>}
      {body}
    </div>
  );
}

function Body({ node, compact }: { node: InsightNode; compact: boolean }) {
  switch (node.type) {
    case "kpi":
      return <Kpi node={node} />;
    case "bar":
    case "line":
    case "area":
    case "pie":
      return <Chart node={node} height={compact ? 180 : 240} />;
    case "table":
      return <DataTable node={node} />;
    case "list":
      return <DataList node={node} />;
    case "markdown":
      return <MiniMarkdown text={node.text} className="nx-in-md" />;
    case "callout":
      return (
        <div className={`nx-in-callout is-${node.tone}`} role="note">
          {node.title && <strong>{node.title}</strong>}
          <MiniMarkdown text={node.text} />
        </div>
      );
    case "progress":
      return <ProgressBlock node={node} />;
    case "comparison":
      return <Comparison node={node} />;
    case "timeline":
      return <TimelineBlock node={node} />;
    /* c8 ignore next 2 -- sections are drawn by Block */
    default:
      return null;
  }
}

function Kpi({ node }: { node: KpiNode }) {
  const delta = node.delta ?? null;
  return (
    <div className="nx-in-kpi-body">
      <span className="nx-in-kpi-label">{node.label}</span>
      <span className="nx-in-kpi-value" data-testid="insight-kpi-value">
        {formatValue(node.value, node.format, true)}
      </span>
      <span className="nx-in-kpi-foot">
        {delta !== null && (
          <span className={`nx-in-delta ${delta >= 0 ? "is-up" : "is-down"}`} data-testid="insight-kpi-delta">
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString(undefined, { maximumFractionDigits: 1 })}%
          </span>
        )}
        {node.hint && <Text type="secondary">{node.hint}</Text>}
      </span>
    </div>
  );
}

function Chart({ node, height }: { node: ChartNode; height: number }) {
  const { chartTheme: theme } = useAppearance();
  const option = useMemo(() => chartOption(node, theme), [node, theme]);
  if (!node.categories.length) return <Text type="secondary">No records match.</Text>;
  return (
    <div data-testid="insight-chart" data-kind={node.type}>
      <ReactECharts option={option} style={{ height, width: "100%" }} notMerge lazyUpdate opts={{ renderer: "canvas" }} />
    </div>
  );
}

type ChartTheme = ReturnType<typeof useAppearance>["chartTheme"];

export function chartOption(node: ChartNode, theme: ChartTheme): Record<string, unknown> {
  const format = (value: number) => formatValue(value, node.format, true);
  const common = {
    color: node.series.length === 1 && node.type !== "pie" ? [theme.accent] : theme.color,
    textStyle: theme.textStyle,
    tooltip: { ...theme.tooltip, trigger: node.type === "pie" ? "item" : "axis", valueFormatter: format },
    legend: node.series.length > 1 || node.type === "pie" ? { ...theme.legend, bottom: 0 } : undefined,
    animationDuration: 400,
  };
  if (node.type === "pie") {
    const series = node.series[0];
    return {
      ...common,
      series: [{
        type: "pie",
        radius: ["48%", "72%"],
        center: ["50%", "44%"],
        itemStyle: theme.pie.itemStyle,
        label: { show: false },
        data: node.categories.map((name, index) => ({ name, value: series?.values[index] ?? 0 })),
      }],
    };
  }
  const horizontal = node.type === "bar" && node.horizontal;
  const category = { type: "category", data: node.categories, ...theme.categoryAxis,
                     axisLabel: { ...theme.categoryAxis.axisLabel, hideOverlap: true } };
  const value = { type: "value", ...theme.valueAxis,
                  axisLabel: { ...theme.valueAxis.axisLabel, formatter: format } };
  return {
    ...common,
    grid: { ...theme.grid, bottom: node.series.length > 1 ? 32 : 8 },
    xAxis: horizontal ? value : category,
    yAxis: horizontal ? category : value,
    series: node.series.map((series) => ({
      name: series.name,
      type: node.type === "bar" ? "bar" : "line",
      data: series.values,
      stack: node.stacked || (node.type === "bar" && node.series.length > 2) ? "total" : undefined,
      smooth: node.type !== "bar",
      showSymbol: false,
      barMaxWidth: 36,
      itemStyle: node.type === "bar" ? theme.bar.itemStyle : undefined,
      lineStyle: node.type !== "bar" ? theme.line.lineStyle : undefined,
      areaStyle: node.type === "area" ? { opacity: 0.18 } : undefined,
    })),
  };
}

function cell(value: unknown, numeric?: boolean): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return formatValue(value, "number", false);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const textual = typeof value === "string" ? value : JSON.stringify(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(textual)) return new Date(textual).toLocaleDateString();
  return numeric ? textual : textual.replace(/_/g, " ");
}

function DataTable({ node }: { node: TableNode }) {
  if (!node.rows.length) return <Text type="secondary">No records match.</Text>;
  return (
    <div className="nx-in-table-wrap">
      <table className="nx-in-table">
        <thead>
          <tr>
            {node.columns.map((column) => (
              <th key={column.key} className={column.numeric ? "is-num" : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {node.rows.map((row, index) => {
            const link = typeof row["href"] === "string" ? row["href"] : null;
            return (
              <tr key={index}>
                {node.columns.map((column, position) => {
                  const content = cell(row[column.key], column.numeric || typeof row[column.key] === "number");
                  return (
                    <td key={column.key} className={column.numeric || typeof row[column.key] === "number" ? "is-num" : undefined}>
                      {position === 0 && link ? <Link to={link}>{content}</Link> : content}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataList({ node }: { node: ListNode }) {
  if (!node.items.length) return <Text type="secondary">Nothing to list.</Text>;
  return (
    <ul className="nx-in-list">
      {node.items.map((item, index) => {
        const title = item.href ? <Link to={item.href}>{item.title}</Link> : item.title;
        return (
          <li key={index}>
            <span className="nx-in-list-main">
              <span className="nx-in-list-title">{title}</span>
              {item.subtitle && <span className="nx-in-list-sub">{item.subtitle.replace(/_/g, " ")}</span>}
            </span>
            {item.status && <StatusTag status={item.status} />}
            {item.value !== null && item.value !== undefined && (
              <span className="nx-in-list-value">{formatValue(item.value, "number", true)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ProgressBlock({ node }: { node: ProgressNode }) {
  const percent = node.max ? Math.min(100, Math.round(((node.value ?? 0) / node.max) * 100)) : 0;
  return (
    <div className="nx-in-progress">
      <span className="nx-in-kpi-label">{node.label}</span>
      <Progress percent={percent} showInfo={false} strokeColor="var(--nu-accent)" />
      <Text type="secondary">
        {formatValue(node.value, node.format)}
        {node.max ? ` of ${formatValue(node.max, node.format)}` : ""}
        {node.hint ? ` · ${node.hint}` : ""}
      </Text>
    </div>
  );
}

function Comparison({ node }: { node: ComparisonNode }) {
  const top = Math.max(1, ...node.items.map((item) => Math.abs(item.value ?? 0)));
  return (
    <ul className="nx-in-compare">
      {node.items.map((item, index) => (
        <li key={index}>
          <span className="nx-in-compare-label">{item.label.replace(/_/g, " ")}</span>
          <span className="nx-in-compare-bar">
            <i style={{ width: `${(Math.abs(item.value ?? 0) / top) * 100}%` }} />
          </span>
          <span className="nx-in-compare-value">{formatValue(item.value, node.format, true)}</span>
        </li>
      ))}
    </ul>
  );
}

function TimelineBlock({ node }: { node: TimelineNode }) {
  if (!node.events.length) return <Text type="secondary">Nothing happened in this window.</Text>;
  const colors = { info: "blue", success: "green", warning: "orange", danger: "red" } as const;
  return (
    <Timeline
      className="nx-in-timeline"
      items={node.events.map((event) => ({
        color: event.tone ? colors[event.tone] : "blue",
        children: (
          <div>
            <Text type="secondary" className="nx-in-timeline-date">
              {event.date}
            </Text>
            <div>{event.href ? <Link to={event.href}>{event.title}</Link> : event.title}</div>
            {event.text && <Text type="secondary">{event.text.replace(/_/g, " ")}</Text>}
          </div>
        ),
      }))}
    />
  );
}
