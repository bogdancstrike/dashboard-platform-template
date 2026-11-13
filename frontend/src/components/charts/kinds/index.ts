/**
 * The chart-kind registry: which builder draws each kind (§28, §44).
 *
 * Keyed on the whole `ChartKind` union, so a kind added to the server without
 * a builder here fails to compile rather than quietly drawing a line chart.
 * Adding a chart is one builder module and one row below.
 */

import type { ChartKind, ChartPanel } from "@/api/dashboard";

import { bars, stacked } from "./bars";
import { funnel } from "./funnel";
import { gauge } from "./gauge";
import { heatmap } from "./heatmap";
import { multiLine } from "./multiLine";
import { pie } from "./pie";
import { radar } from "./radar";
import type { Theme } from "./shared";
import { scatter } from "./scatter";
import { timeSeries } from "./timeSeries";
import { treemap } from "./treemap";

/** Takes the themed base and returns a complete option. */
export type ChartBuilder = (panel: ChartPanel, theme: Theme) => Record<string, unknown>;

export const CHART_BUILDERS: Record<ChartKind, ChartBuilder> = {
  line: timeSeries,
  area: timeSeries,
  pie,
  bar: (panel, theme) => bars(panel, theme, false),
  hbar: (panel, theme) => bars(panel, theme, true),
  "stacked-bar": (panel, theme) => stacked(panel, theme, false),
  "stacked-hbar": (panel, theme) => stacked(panel, theme, true),
  "multi-line": (panel, theme) => multiLine(panel, theme, false),
  "stacked-area": (panel, theme) => multiLine(panel, theme, true),
  funnel,
  gauge,
  heatmap,
  scatter,
  radar,
  treemap,
};
