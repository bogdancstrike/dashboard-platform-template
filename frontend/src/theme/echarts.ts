/**
 * The ECharts theme, from the same tokens as everything else.
 *
 * A chart themed independently of the application around it is a chart whose
 * grid lines are a slightly different grey from the table beside it — and that
 * difference is visible precisely where a reader is comparing the two.
 */

import { DENSITY, FONT, INK, NEUTRAL, PAPER, SERIES, type Density } from "./tokens";

export function buildChartTheme(mode: "light" | "dark", density: Density) {
  const dark = mode === "dark";
  const text = dark ? INK[300] : NEUTRAL[600];
  const axis = dark ? INK[650] : NEUTRAL[200];
  // The glass canvas: a soft hairline grid, never a dashed one.
  const grid = dark ? "rgba(243, 231, 210, 0.08)" : "rgba(27, 30, 38, 0.07)";
  const scale = DENSITY[density];
  // The design's single-series ramp: the accent, then lighter and deeper
  // steps of it. Lavender in the dark, blue in the light.
  const ramp = dark
    ? ["#C4B5FD", "#7C6BD6", "#EAE3FF", "#9F8DF2", "#5A4AB0"]
    : ["#2457D6", "#8FA9EE", "#163A96", "#C3D1F6", "#5B7FE0"];

  return {
    /** The accent a one-series chart is drawn in, and its ramp. */
    accent: ramp[0] as string,
    ramp,
    color: dark ? [ramp[0], ...SERIES.slice(1)] : [...SERIES],
    backgroundColor: "transparent",
    textStyle: { fontFamily: FONT.family, fontSize: scale.fontSize - 1, color: text },
    title: {
      textStyle: { color: dark ? INK[100] : NEUTRAL[900], fontWeight: 600 },
      subtextStyle: { color: dark ? INK[400] : NEUTRAL[500] },
    },
    grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
    categoryAxis: {
      axisLine: { lineStyle: { color: axis } },
      axisTick: { show: false },
      axisLabel: { color: text },
      // No vertical grid lines: they add ink without adding information on a
      // category axis, and the bars already mark the categories.
      splitLine: { show: false },
    },
    valueAxis: {
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: text },
      splitLine: { lineStyle: { color: grid, type: "solid" } },
    },
    legend: {
      textStyle: { color: text },
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
    },
    tooltip: {
      backgroundColor: dark ? "rgba(30, 24, 34, 0.94)" : "rgba(255, 255, 255, 0.96)",
      borderColor: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(27, 30, 38, 0.08)",
      borderWidth: 1,
      extraCssText: "border-radius: 14px; box-shadow: 0 18px 40px rgba(40, 35, 60, 0.18); backdrop-filter: blur(20px);",
      textStyle: { color: dark ? INK[100] : NEUTRAL[900], fontSize: scale.fontSize },
      axisPointer: { lineStyle: { color: dark ? INK[500] : NEUTRAL[400] }, crossStyle: { color: dark ? INK[500] : NEUTRAL[400] } },
    },
    line: { smooth: false, symbolSize: 6, lineStyle: { width: 2.5 } },
    bar: { itemStyle: { borderRadius: [6, 6, 0, 0] } },
    pie: {
      itemStyle: { borderColor: dark ? INK[800] : PAPER, borderWidth: 2 },
      label: { color: text },
    },
  };
}

export const CHART_THEME_NAME = "nucleus";
