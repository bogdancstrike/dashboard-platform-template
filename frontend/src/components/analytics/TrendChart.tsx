/**
 * One line over time, optionally with an expected band and marked points —
 * the health trend (§12) and a watched metric with its anomalies (§22) are
 * both this picture. Drawn with the platform's ECharts theme so it matches
 * every other chart in light and dark.
 */
import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import { useAppearance } from "@/theme/AppearanceProvider";
import { buildChartTheme } from "@/theme/echarts";

export interface TrendPoint {
  at: string;
  value: number;
  upper?: number;
  lower?: number;
  marked?: boolean;
}

export function TrendChart({
  points,
  height = 220,
  label,
  bands,
  kind = "line",
  format = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 1 }),
  dateFormat = (at: string) => at.slice(5, 10),
  yMax,
}: {
  points: TrendPoint[];
  height?: number;
  label: string;
  /** Horizontal guide lines (e.g. the health band cut-offs). */
  bands?: { value: number; name: string }[];
  kind?: "line" | "bar";
  format?: (value: number) => string;
  dateFormat?: (at: string) => string;
  yMax?: number;
}) {
  const appearance = useAppearance();
  const option = useMemo(() => {
    const theme = buildChartTheme(appearance.mode, appearance.density) as Record<string, unknown> & {
      color?: string[]; textStyle?: { color?: string };
    };
    const accent = theme.color?.[0] ?? "#2457D6";
    const text = theme.textStyle?.color ?? "#5C6370";
    const hasBand = points.some((p) => p.upper !== undefined);
    const categories = points.map((p) => dateFormat(p.at));
    const series: Record<string, unknown>[] = [];
    if (hasBand) {
      series.push(
        { name: "lower", type: "line", data: points.map((p) => p.lower ?? null), stack: "band", symbol: "none",
          lineStyle: { opacity: 0 }, tooltip: { show: false } },
        { name: "Expected range", type: "line", data: points.map((p) => (p.upper ?? 0) - (p.lower ?? 0)), stack: "band",
          symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: accent, opacity: 0.1 } },
      );
    }
    series.push({
      name: label,
      type: kind,
      data: points.map((p) => p.value),
      smooth: kind === "line" ? 0.25 : undefined,
      symbol: "circle",
      symbolSize: 4,
      showSymbol: false,
      barMaxWidth: 22,
      itemStyle: { color: accent, borderRadius: kind === "bar" ? [6, 6, 0, 0] : undefined },
      lineStyle: { width: 2.5, color: accent },
      areaStyle: kind === "line" && !hasBand ? { color: accent, opacity: 0.08 } : undefined,
      markPoint: {
        symbol: "circle",
        symbolSize: 12,
        itemStyle: { color: "#D64545", borderColor: "#fff", borderWidth: 2 },
        label: { show: false },
        data: points
          .map((p, index) => (p.marked ? { coord: [index, p.value], value: p.value } : null))
          .filter(Boolean),
      },
      markLine: bands?.length
        ? {
            silent: true,
            symbol: "none",
            label: { color: text, fontSize: 10, formatter: "{b}" },
            lineStyle: { type: "dashed", opacity: 0.5 },
            data: bands.map((b) => ({ yAxis: b.value, name: b.name })),
          }
        : undefined,
    });
    return {
      ...theme,
      legend: { show: false },
      grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: number) => (typeof value === "number" ? format(value) : String(value ?? "")),
      },
      xAxis: { type: "category", data: categories, boundaryGap: kind === "bar", axisTick: { show: false } },
      yAxis: { type: "value", max: yMax, axisLabel: { formatter: (v: number) => format(v) }, splitLine: { lineStyle: { opacity: 0.6 } } },
      series,
    };
  }, [points, label, bands, kind, format, dateFormat, yMax, appearance.mode, appearance.density]);

  return (
    <figure style={{ margin: 0 }} aria-label={label}>
      <ReactECharts option={option} style={{ height, width: "100%" }} notMerge lazyUpdate opts={{ renderer: "canvas" }} />
    </figure>
  );
}
