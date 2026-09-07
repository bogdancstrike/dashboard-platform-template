/**
 * ECharts options, one builder per chart kind (§28, §44).
 *
 * Split out of `ChartCard` because the card is about *chrome* — the title, the
 * table view, the CSV download, the drill-down — and this is about the data.
 * Twelve kinds inside one `useMemo` is a four-hundred-line function with a
 * dozen early returns, which is the shape code takes just before somebody
 * copies a chart instead of adding one.
 *
 * Every builder takes the themed base and returns a complete option, so the
 * card never merges two half-options and no builder can quietly lose the
 * theme's axis colours.
 *
 * The rules they all follow:
 *
 * * **Colour means something.** A known status keeps the colour its badge has
 *   everywhere else; anything else takes the series palette in order.
 * * **Every label is present or none is.** Dropping half the category labels
 *   silently is worse than tilting them: the reader cannot tell which bar the
 *   surviving label belongs to.
 * * **Numbers are compact on an axis and full in a tooltip.** "10,000,000"
 *   costs 70px to say what "10M" says in 12.
 */

import type { ChartPanel, ChartPoint } from "@/api/dashboard";
import { format } from "echarts";
import { categoryColor, SEMANTIC, SERIES } from "@/theme/tokens";
import type { buildChartTheme } from "@/theme/echarts";

type Theme = ReturnType<typeof buildChartTheme>;

export function compactNumber(value: number): string {
  const size = Math.abs(value);
  if (size >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (size >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (size >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value * 100) / 100);
}

/** Distinct groups, in the order the server declared or first sighting. */
function groupsOf(panel: ChartPanel): string[] {
  if (panel.groups && panel.groups.length > 0) return panel.groups;
  const seen: string[] = [];
  for (const point of panel.series) {
    const group = point.group ?? "—";
    if (!seen.includes(group)) seen.push(group);
  }
  return seen;
}

/** Distinct buckets or names along the category axis, in series order. */
function categoriesOf(panel: ChartPanel): string[] {
  const seen: string[] = [];
  for (const point of panel.series) {
    const key = point.bucket ?? point.name ?? "—";
    if (!seen.includes(key)) seen.push(key);
  }
  return panel.series.some((point) => point.bucket !== undefined) ? seen.sort() : seen;
}

function labelFor(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * The value at (category, group), or zero.
 *
 * Zero rather than absent: a stacked bar with a hole in it is drawn as a
 * shorter stack, and the reader cannot tell "no orders that week" from "that
 * channel was missing from the result".
 */
function table(panel: ChartPanel, categories: string[], groups: string[]): number[][] {
  const cells = groups.map(() => categories.map(() => 0));
  for (const point of panel.series) {
    const column = categories.indexOf(point.bucket ?? point.name ?? "—");
    const row = groups.indexOf(point.group ?? "—");
    if (column >= 0 && row >= 0) cells[row]![column]! += point.value;
  }
  return cells;
}

export function buildOption(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  switch (panel.kind) {
    case "pie":
      return pie(panel, theme);
    case "hbar":
      return bars(panel, theme, true);
    case "bar":
      return bars(panel, theme, false);
    case "stacked-bar":
      return stacked(panel, theme, false);
    case "stacked-hbar":
      return stacked(panel, theme, true);
    case "multi-line":
      return multiLine(panel, theme);
    case "funnel":
      return funnel(panel, theme);
    case "gauge":
      return gauge(panel, theme);
    case "heatmap":
      return heatmap(panel, theme);
    case "scatter":
      return scatter(panel, theme);
    case "radar":
      return radar(panel, theme);
    case "treemap":
      return treemap(panel, theme);
    default:
      return timeSeries(panel, theme);
  }
}

function pie(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "item" },
    legend: { ...theme.legend, bottom: 0, left: "center" },
    series: [
      {
        type: "pie",
        radius: ["48%", "72%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        itemStyle: theme.pie.itemStyle,
        label: { show: false },
        data: panel.series.map((point, index) => ({
          name: point.name ?? "—",
          value: point.value,
          itemStyle: { color: categoryColor(point.name, index) },
        })),
      },
    ],
  };
}

function timeSeries(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const categories = categoriesOf(panel);
  const isTime = panel.series.some((point) => point.bucket !== undefined);
  const crowded = !isTime && categories.length > 4;

  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "axis" },
    grid: { ...theme.grid, top: 16, bottom: crowded ? 28 : 4 },
    xAxis: {
      ...theme.categoryAxis,
      type: "category",
      data: categories.map(labelFor),
      axisLabel: {
        ...theme.categoryAxis.axisLabel,
        interval: isTime ? "auto" : 0,
        rotate: crowded ? 30 : 0,
        hideOverlap: isTime,
        ...(crowded ? { width: 84, overflow: "truncate" } : {}),
      },
    },
    yAxis: {
      ...theme.valueAxis,
      type: "value",
      axisLabel: { ...theme.valueAxis.axisLabel, formatter: compactNumber },
    },
    series: [
      {
        type: "line",
        data: panel.series.map((point) => point.value),
        smooth: false,
        symbol: isTime ? "none" : "circle",
        lineStyle: { width: 2 },
        itemStyle: { color: SERIES[0] },
        ...(panel.kind === "area"
          ? {
              areaStyle: {
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: `${SERIES[0]}47` },
                    { offset: 1, color: `${SERIES[0]}05` },
                  ],
                },
              },
            }
          : {}),
      },
    ],
  };
}

function bars(panel: ChartPanel, theme: Theme, horizontal: boolean): Record<string, unknown> {
  const categories = categoriesOf(panel);
  const crowded = !horizontal && categories.length > 4;
  const value = {
    ...theme.valueAxis,
    type: "value",
    axisLabel: { ...theme.valueAxis.axisLabel, formatter: compactNumber },
  };
  const category = {
    ...theme.categoryAxis,
    type: "category",
    // A horizontal bar chart is read top to bottom and the server sent the
    // largest first, so the axis is inverted to keep it at the top.
    ...(horizontal ? { inverse: true } : {}),
    data: categories.map(labelFor),
    axisLabel: {
      ...theme.categoryAxis.axisLabel,
      interval: 0,
      rotate: crowded ? 30 : 0,
      ...(horizontal ? { width: 130, overflow: "truncate" } : {}),
      ...(crowded ? { width: 84, overflow: "truncate" } : {}),
    },
  };

  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
    grid: {
      ...theme.grid,
      top: 16,
      bottom: crowded ? 28 : 4,
      ...(horizontal ? { left: 150 } : {}),
    },
    xAxis: horizontal ? value : category,
    yAxis: horizontal ? category : value,
    series: [
      {
        type: "bar",
        barMaxWidth: 22,
        data: panel.series.map((point, index) => ({
          value: point.value,
          itemStyle: {
            color: categoryColor(point.name, index),
            borderRadius: horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0],
          },
        })),
      },
    ],
  };
}

function stacked(panel: ChartPanel, theme: Theme, horizontal: boolean): Record<string, unknown> {
  const categories = categoriesOf(panel);
  const groups = groupsOf(panel);
  const cells = table(panel, categories, groups);

  const value = {
    ...theme.valueAxis,
    type: "value",
    axisLabel: { ...theme.valueAxis.axisLabel, formatter: compactNumber },
  };
  const category = {
    ...theme.categoryAxis,
    type: "category",
    ...(horizontal ? { inverse: true } : {}),
    data: categories.map(labelFor),
    axisLabel: {
      ...theme.categoryAxis.axisLabel,
      hideOverlap: true,
      ...(horizontal ? { width: 110, overflow: "truncate" } : {}),
    },
  };

  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
    legend: { ...theme.legend, bottom: 0, data: groups },
    grid: { ...theme.grid, top: 16, bottom: 32, ...(horizontal ? { left: 130 } : {}) },
    xAxis: horizontal ? value : category,
    yAxis: horizontal ? category : value,
    series: groups.map((group, index) => ({
      name: group,
      type: "bar",
      stack: "total",
      barMaxWidth: 26,
      itemStyle: { color: categoryColor(group, index) },
      data: cells[index],
    })),
  };
}

function multiLine(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const categories = categoriesOf(panel);
  const groups = groupsOf(panel);
  const cells = table(panel, categories, groups);

  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "axis" },
    legend: { ...theme.legend, bottom: 0, data: groups },
    grid: { ...theme.grid, top: 16, bottom: 32 },
    xAxis: {
      ...theme.categoryAxis,
      type: "category",
      data: categories.map(labelFor),
      axisLabel: { ...theme.categoryAxis.axisLabel, hideOverlap: true },
    },
    yAxis: {
      ...theme.valueAxis,
      type: "value",
      axisLabel: { ...theme.valueAxis.axisLabel, formatter: compactNumber },
    },
    series: groups.map((group, index) => ({
      name: group,
      type: "line",
      smooth: true,
      symbol: "none",
      lineStyle: { width: 2, color: SERIES[index % SERIES.length] },
      itemStyle: { color: SERIES[index % SERIES.length] },
      data: cells[index],
    })),
  };
}

function funnel(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const first = panel.series[0]?.value ?? 0;
  return {
    ...theme,
    tooltip: {
      ...theme.tooltip,
      trigger: "item",
      // Share of the *first* stage, which is the number somebody is after:
      // "62% of orders placed reached delivery".
      formatter: (params: { name?: string; value?: number }) =>
        `${format.encodeHTML(params.name ?? "")}<br/>${(params.value ?? 0).toLocaleString()}` +
        (first ? ` · ${Math.round((100 * (params.value ?? 0)) / first)}% of placed` : ""),
    },
    legend: { ...theme.legend, bottom: 0 },
    series: [
      {
        type: "funnel",
        top: 10,
        bottom: 34,
        left: "8%",
        width: "84%",
        minSize: "24%",
        sort: "none",
        gap: 3,
        label: { show: true, position: "inside", fontWeight: 600 },
        itemStyle: { borderWidth: 0 },
        data: panel.series.map((point, index) => ({
          name: point.name ?? "—",
          value: point.value,
          itemStyle: { color: SERIES[index % SERIES.length] },
        })),
      },
    ],
  };
}

function gauge(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const point: ChartPoint = panel.series[0] ?? { value: 0 };
  // Green above 90, amber above 75, red below — the thresholds an operations
  // team already argues in, rather than a gradient nobody reads a number off.
  const colour =
    point.value >= 90 ? SEMANTIC.success : point.value >= 75 ? SEMANTIC.warning : SEMANTIC.danger;

  return {
    ...theme,
    tooltip: { show: false },
    series: [
      {
        type: "gauge",
        startAngle: 210,
        endAngle: -30,
        min: 0,
        max: 100,
        radius: "92%",
        center: ["50%", "58%"],
        progress: { show: true, width: 14, itemStyle: { color: colour } },
        axisLine: { lineStyle: { width: 14 } },
        axisTick: { show: false },
        splitLine: { length: 8, lineStyle: { width: 1 } },
        axisLabel: { distance: 16, fontSize: 10 },
        pointer: { show: false },
        anchor: { show: false },
        title: { offsetCenter: [0, "34%"], fontSize: 11 },
        detail: {
          offsetCenter: [0, "-4%"],
          fontSize: 30,
          fontWeight: 600,
          color: colour,
          formatter: "{value}%",
        },
        data: [{ value: point.value, name: point.name ?? "" }],
      },
    ],
  };
}

/**
 * Two dimensions and a count, as a grid.
 *
 * The axes are the panel's own — `groups` across, `categories` down — rather
 * than a weekday-by-hour calendar written in here. A renderer that knows one
 * chart is about weekdays can only ever draw that chart, and "when are we
 * busy" is one of many two-dimensional questions.
 */
function heatmap(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const columns = panel.groups ?? groupsOf(panel);
  const rows = panel.categories ?? categoriesOf(panel);
  const max = Math.max(...panel.series.map((point) => point.value), 1);

  return {
    ...theme,
    tooltip: {
      ...theme.tooltip,
      trigger: "item",
      formatter: (params: { value?: number[] }) =>
        params.value
          ? `${format.encodeHTML(rows[params.value[1] ?? 0] ?? "")} · ${format.encodeHTML(
              columns[params.value[0] ?? 0] ?? "",
            )} · ${params.value[2] ?? 0}`
          : "",
    },
    grid: { ...theme.grid, top: 10, bottom: 46, left: 44, right: 12 },
    xAxis: {
      ...theme.categoryAxis,
      type: "category",
      data: columns,
      splitArea: { show: true },
      // Every other label once the axis is crowded. Twenty-four hours do not
      // fit; six channels do, and thinning those would hide half of them.
      axisLabel: {
        ...theme.categoryAxis.axisLabel,
        interval: columns.length > 12 ? 2 : 0,
      },
    },
    yAxis: { ...theme.categoryAxis, type: "category", data: rows, splitArea: { show: true } },
    visualMap: {
      min: 0,
      max,
      calculable: false,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemHeight: 80,
      textStyle: theme.categoryAxis.axisLabel,
      // A single-hue ramp: two hues in a heatmap read as two categories.
      inRange: { color: [theme.tooltip.backgroundColor, SERIES[0]] },
    },
    series: [
      {
        type: "heatmap",
        data: panel.series.map((point) => [
          columns.indexOf(point.group ?? "—"),
          rows.indexOf(point.name ?? "—"),
          point.value,
        ]),
        label: { show: false },
        itemStyle: { borderWidth: 1, borderColor: "transparent" },
      },
    ],
  };
}

/**
 * Two measures against each other, one point per record.
 *
 * The axis names and their unit come from the panel. A scatter whose renderer
 * knows it is about budget and progress is a scatter that can only ever be
 * about budget and progress — and a correlation is exactly the chart a builder
 * should be able to point at any two numbers.
 */
function scatter(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const groups = groupsOf(panel);
  const biggest = Math.max(...panel.series.map((point) => point.value), 1);
  const axes = panel.axes ?? { x: "x", y: "y" };
  const suffix = axes.format === "percent" ? "%" : "";
  // A percentage axis is bounded by its own definition; anything else is
  // bounded by the data, and forcing 0–100 onto revenue draws every point in
  // the bottom-left corner.
  const bound = (values: number[]) =>
    axes.format === "percent" ? Math.max(100, ...values) : undefined;

  return {
    ...theme,
    tooltip: {
      ...theme.tooltip,
      trigger: "item",
      formatter: (params: { data?: { name?: string; value?: number[] } }) => {
        const value = params.data?.value;
        if (!value) return "";
        return `${format.encodeHTML(params.data?.name ?? "")}<br/>${format.encodeHTML(
          axes.x,
        )} ${compactNumber(value[0] ?? 0)}${suffix} · ${format.encodeHTML(
          axes.y,
        )} ${compactNumber(value[1] ?? 0)}${suffix}`;
      },
    },
    // A legend of one unnamed series is a legend that says "—". It appears
    // when the points are actually grouped and not before.
    legend:
      groups.length > 1
        ? { ...theme.legend, bottom: 0, data: groups }
        : { show: false },
    grid: { ...theme.grid, top: 16, bottom: groups.length > 1 ? 34 : 12, left: 56 },
    xAxis: {
      ...theme.valueAxis,
      type: "value",
      name: axes.x,
      nameLocation: "middle",
      nameGap: 24,
      max: bound(panel.series.map((point) => point.x ?? 0)),
      axisLabel: { ...theme.valueAxis.axisLabel, formatter: `{value}${suffix}` },
    },
    yAxis: {
      ...theme.valueAxis,
      type: "value",
      // Along the axis rather than above its corner: ECharts' default parks a
      // vertical axis name in the top-left, where it is read as a stray word.
      name: axes.y,
      nameLocation: "middle",
      nameRotate: 90,
      nameGap: 44,
      max: bound(panel.series.map((point) => point.y ?? 0)),
      axisLabel: { ...theme.valueAxis.axisLabel, formatter: `{value}${suffix}` },
    },
    series: groups.map((group, index) => ({
      name: group,
      type: "scatter",
      // Sized by the third number, when there is one: a €4M project off the
      // diagonal matters more than a €40k one in the same place.
      symbolSize: (value: number[]) => 8 + Math.sqrt((value[2] ?? 0) / biggest) * 22,
      itemStyle: { color: categoryColor(group, index), opacity: 0.85 },
      data: panel.series
        .filter((point) => (point.group ?? "—") === group)
        .map((point) => ({ name: point.name, value: [point.x ?? 0, point.y ?? 0, point.value] })),
    })),
  };
}

/** Shared count scale keeps the radar's axes comparable. */
function radar(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  const max = Math.max(1, ...panel.series.map((point) => point.value));
  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "item" },
    radar: {
      radius: "62%",
      indicator: panel.series.map((point) => ({ name: point.name, max })),
      axisName: { color: theme.textStyle.color },
      splitLine: theme.valueAxis.splitLine,
      splitArea: { show: false },
    },
    series: [{
      type: "radar",
      data: [{ name: panel.title, value: panel.series.map((point) => point.value) }],
      areaStyle: { opacity: 0.15 },
    }],
  };
}

/** Budget belongs to a project within a health group; both levels retain totals. */
function treemap(panel: ChartPanel, theme: Theme): Record<string, unknown> {
  return {
    ...theme,
    tooltip: { ...theme.tooltip, trigger: "item" },
    series: [{
      type: "treemap",
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      top: 8, bottom: 8, left: 0, right: 0,
      upperLabel: { show: true, height: 22 },
      itemStyle: { borderColor: theme.tooltip.backgroundColor, borderWidth: 2, gapWidth: 2 },
      data: groupsOf(panel).map((group, index) => ({
        name: group,
        itemStyle: { color: categoryColor(group, index) },
        children: panel.series.filter((point) => (point.group ?? "—") === group)
          .map((point) => ({ name: point.name, value: point.value })),
      })),
    }],
  };
}
