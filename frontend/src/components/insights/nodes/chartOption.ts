import { useAppearance } from "@/theme/AppearanceProvider";

import { formatValue, type ChartNode } from "../spec";

type ChartTheme = ReturnType<typeof useAppearance>["chartTheme"];

export function chartOption(node: ChartNode, theme: ChartTheme): Record<string, unknown> {
  const format = (value: number) => formatValue(value, node.format, true);
  const common = {
    color: node.series.length === 1 && node.type !== "pie" ? [theme.accent] : theme.color,
    textStyle: theme.textStyle,
    tooltip: {
      ...theme.tooltip,
      trigger: node.type === "pie" ? "item" : "axis",
      valueFormatter: format,
    },
    legend:
      node.series.length > 1 || node.type === "pie" ? { ...theme.legend, bottom: 0 } : undefined,
    animationDuration: 400,
  };
  if (node.type === "pie") {
    const series = node.series[0];
    return {
      ...common,
      series: [
        {
          type: "pie",
          radius: ["48%", "72%"],
          center: ["50%", "44%"],
          itemStyle: theme.pie.itemStyle,
          label: { show: false },
          data: node.categories.map((name, index) => ({ name, value: series?.values[index] ?? 0 })),
        },
      ],
    };
  }
  const horizontal = node.type === "bar" && node.horizontal;
  const category = {
    type: "category",
    data: node.categories,
    ...theme.categoryAxis,
    axisLabel: { ...theme.categoryAxis.axisLabel, hideOverlap: true },
  };
  const value = {
    type: "value",
    ...theme.valueAxis,
    axisLabel: { ...theme.valueAxis.axisLabel, formatter: format },
  };
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
