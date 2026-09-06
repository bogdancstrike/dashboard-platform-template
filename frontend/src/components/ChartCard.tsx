import { useMemo, useState, type ReactNode } from "react";
import { Button, Card, Segmented, Table, Tooltip, Typography } from "antd";
import { BarChartOutlined, DownloadOutlined, TableOutlined } from "@ant-design/icons";
import ReactECharts from "echarts-for-react";

import type { ChartPanel } from "@/api/dashboard";
import { useAppearance } from "@/theme/AppearanceProvider";

import { buildOption } from "./charts/options";
import { chartColumns, chartCsv } from "./charts/data";
import { EmptyState } from "./EmptyState";

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

  const choose = (next: "chart" | "table") => {
    setView(next);
    try {
      window.localStorage.setItem(`nucleus.chart.${id}`, next);
    } catch {
      /* storage disabled; the choice just does not persist */
    }
  };

  // One builder per kind, in `charts/options.ts`. The card is chrome — title,
  // table view, CSV, drill-down — and the option is data; keeping twelve kinds
  // inside this component is how a codebase ends up with a copied chart
  // instead of a new one.
  const option = useMemo(
    () => (panel ? { ...buildOption(panel, chartTheme), aria: { enabled: true },
      animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches } : {}),
    [panel, chartTheme],
  );

  const download = () => {
    if (!panel) return;
    const blob = new Blob([chartCsv(panel)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${id}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  return (
    <Card
      size="small"
      className="nu-chartcard"
      data-chart-id={id}
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
      {panel?.description && <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        {panel.description}
      </Typography.Paragraph>}
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
                    if (params.name) onSelect(params.name);
                  },
                }
              : undefined
          }
        />
      ) : (
        <Table
          size="small"
          rowKey="chartRowKey"
          dataSource={rows.map((row, index) => ({ ...row, chartRowKey: index }))}
          pagination={rows.length > 10 ? { pageSize: 10, size: "small" } : false}
          scroll={{ y: height - 40 }}
          columns={panel ? chartColumns(panel).map((column) => ({
            title: column.label,
            dataIndex: column.key,
            render: (value: string | number | undefined) => typeof value === "number" ? value.toLocaleString() : value ?? "—",
          })) : []}
          onRow={
            onSelect
              ? (row) => ({
                  onClick: () => onSelect(String(row.name ?? row.bucket)),
                  tabIndex: 0,
                  onKeyDown: (event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(String(row.name ?? row.bucket));
                    }
                  },
                  style: { cursor: "pointer" },
                })
              : undefined
          }
        />
      )}
    </Card>
  );
}
