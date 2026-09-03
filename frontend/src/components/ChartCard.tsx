import { useMemo, useState, type ReactNode } from "react";
import { Button, Card, Segmented, Table, Tooltip } from "antd";
import { BarChartOutlined, DownloadOutlined, TableOutlined } from "@ant-design/icons";
import ReactECharts from "echarts-for-react";

import type { ChartPanel } from "@/api/dashboard";
import { useAppearance } from "@/theme/AppearanceProvider";
import { SERIES, categoryColor } from "@/theme/tokens";

import { EmptyState } from "./EmptyState";

/** 12,400,000 → "12.4M". An axis is not the place to count zeroes. */
function compactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(value);
}

/**
 * A chart that can always be read as a table.
 *
 * Charts are for shape; tables are for "what exactly was the number on the
 * 14th". Every panel offers both from the same data and remembers which one
 * was chosen, so somebody who thinks in numbers does not re-flip six cards on
 * every visit. The CSV button exports the same rows (§30) — a chart you cannot
 * get the numbers out of is a chart people screenshot into a spreadsheet.
 */
export function ChartCard({
  id,
  panel,
  height = 260,
  extra,
  onSelect,
  loading = false,
}: {
  /** Stable key — the chosen view is remembered under it. */
  id: string;
  panel: ChartPanel | undefined;
  height?: number;
  extra?: ReactNode;
  /** Clicking a bar, slice or row drills into the records behind it (§44). */
  onSelect?: (name: string) => void;
  loading?: boolean;
}) {
  const { chartTheme } = useAppearance();
  const [view, setView] = useState<"chart" | "table">(() => {
    try {
      const stored = window.localStorage.getItem(`nucleus.chart.${id}`);
      return stored === "table" ? "table" : "chart";
    } catch {
      return "chart";
    }
  });

  const rows = panel?.series ?? [];
  const isTimeSeries = rows.length > 0 && rows[0]?.bucket !== undefined;

  const choose = (next: "chart" | "table") => {
    setView(next);
    try {
      window.localStorage.setItem(`nucleus.chart.${id}`, next);
    } catch {
      /* storage disabled; the choice just does not persist */
    }
  };

  const labels = useMemo(
    () =>
      rows.map((row) =>
        row.bucket ? new Date(row.bucket).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : (row.name ?? "—"),
      ),
    [rows],
  );

  const option = useMemo(() => {
    if (!panel) return {};
    const values = rows.map((row) => row.value);

    if (panel.kind === "pie") {
      return {
        ...chartTheme,
        tooltip: { ...chartTheme.tooltip, trigger: "item" },
        legend: { ...chartTheme.legend, bottom: 0, left: "center" },
        series: [
          {
            type: "pie",
            radius: ["48%", "72%"],
            center: ["50%", "44%"],
            avoidLabelOverlap: true,
            itemStyle: chartTheme.pie.itemStyle,
            label: { show: false },
            data: rows.map((row, index) => ({
              name: row.name ?? "—",
              value: row.value,
              // A known status keeps the colour its badge has elsewhere; the
              // rest take the series palette.
              itemStyle: { color: categoryColor(row.name, index) },
            })),
          },
        ],
      };
    }

    const area = panel.kind === "area";
    // A category axis has to show every label — dropping half of them silently
    // is worse than tilting them, because the reader cannot tell which bar the
    // surviving label belongs to. Tilted once there are more than four, and the
    // grid gains the depth to fit them.
    const crowded = !isTimeSeries && rows.length > 4;
    return {
      ...chartTheme,
      tooltip: { ...chartTheme.tooltip, trigger: "axis" },
      grid: { ...chartTheme.grid, top: 16, bottom: crowded ? 28 : 4 },
      xAxis: {
        ...chartTheme.categoryAxis,
        type: "category",
        data: labels,
        axisLabel: {
          ...chartTheme.categoryAxis.axisLabel,
          interval: isTimeSeries ? "auto" : 0,
          rotate: crowded ? 30 : 0,
          hideOverlap: isTimeSeries,
          // A tilted label runs past the left edge of the grid and gets clipped
          // by the card. Truncating keeps every label present and readable; the
          // full text is one hover away in the tooltip, and the table view has
          // it in full.
          ...(crowded ? { width: 84, overflow: "truncate" } : {}),
        },
      },
      yAxis: {
        ...chartTheme.valueAxis,
        type: "value",
        // "10,000,000" costs 70px of chart width to say what "10M" says in 12.
        axisLabel: { ...chartTheme.valueAxis.axisLabel, formatter: compactNumber },
      },
      series: [
        {
          type: panel.kind === "bar" ? "bar" : "line",
          data: values,
          smooth: false,
          symbol: isTimeSeries ? "none" : "circle",
          lineStyle: { width: 2 },
          itemStyle: {
            // A status bar takes the colour its badge has everywhere else, so
            // "DONE" is the same green on the chart, in the table and on the
            // board. Anything that is not a known status falls back to the
            // series colour rather than inventing one.
            color:
              panel.kind === "bar" && !isTimeSeries
                ? (params: { name?: string; dataIndex?: number }) =>
                    categoryColor(params.name, params.dataIndex ?? 0)
                : SERIES[0],
            borderRadius: panel.kind === "bar" ? [3, 3, 0, 0] : 0,
          },
          ...(area
            ? {
                areaStyle: {
                  color: {
                    type: "linear",
                    x: 0, y: 0, x2: 0, y2: 1,
                    colorStops: [
                      { offset: 0, color: "rgba(91, 91, 214, 0.28)" },
                      { offset: 1, color: "rgba(91, 91, 214, 0.02)" },
                    ],
                  },
                }
              }
            : {}),
        },
      ],
    };
  }, [panel, rows, labels, chartTheme, isTimeSeries]);

  const download = () => {
    const header = isTimeSeries ? "date,value" : "name,value";
    const body = rows.map((row) => {
      const key = row.bucket ?? row.name ?? "";
      const escaped = /[",\n]/.test(key) ? `"${key.replace(/"/g, '""')}"` : key;
      return `${escaped},${row.value}`;
    });
    const blob = new Blob([[header, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${id}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Card
      size="small"
      className="nu-chartcard"
      loading={loading}
      title={panel?.title ?? ""}
      extra={
        <span className="nu-chart-extra">
          {extra}
          <Tooltip title="Download this panel as CSV">
            <Button
              type="text"
              size="small"
              disabled={rows.length === 0}
              aria-label="Download this panel as CSV"
              icon={<DownloadOutlined />}
              onClick={download}
            />
          </Tooltip>
          <Segmented
            size="small"
            value={view}
            onChange={(next) => choose(next as "chart" | "table")}
            options={[
              { value: "chart", icon: <BarChartOutlined />, title: "Chart" },
              { value: "table", icon: <TableOutlined />, title: "Table" },
            ]}
          />
        </span>
      }
    >
      {rows.length === 0 ? (
        <div style={{ minHeight: height, display: "grid", placeItems: "center" }}>
          <EmptyState title="Nothing in this period" compact />
        </div>
      ) : view === "chart" ? (
        <ReactECharts
          option={option}
          style={{ height, cursor: onSelect ? "pointer" : "default" }}
          notMerge
          onEvents={
            onSelect
              ? {
                  click: (params: { name?: string }) => {
                    if (params?.name) onSelect(String(params.name));
                  },
                }
              : undefined
          }
        />
      ) : (
        <Table
          size="small"
          rowKey={(row) => String(row.bucket ?? row.name)}
          dataSource={rows}
          pagination={rows.length > 10 ? { pageSize: 10, size: "small" } : false}
          scroll={{ y: height - 40 }}
          columns={[
            {
              title: isTimeSeries ? "Date" : "Name",
              dataIndex: isTimeSeries ? "bucket" : "name",
              render: (value: string) =>
                isTimeSeries ? new Date(value).toLocaleDateString() : value,
            },
            {
              title: "Value",
              dataIndex: "value",
              align: "right" as const,
              width: 120,
              render: (value: number) => value.toLocaleString(),
            },
          ]}
          onRow={
            onSelect
              ? (row) => ({
                  onClick: () => onSelect(String(row.name ?? row.bucket)),
                  style: { cursor: "pointer" },
                })
              : undefined
          }
        />
      )}
    </Card>
  );
}
