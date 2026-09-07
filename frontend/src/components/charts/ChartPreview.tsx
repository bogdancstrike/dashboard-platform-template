/**
 * A chart on its own, in a theme it is told to use.
 *
 * `ChartCard` is about *chrome* — the title, the table view, the CSV download,
 * the drill-down — and there are two places that want the picture without any
 * of it: a gallery thumbnail, where the chrome would be larger than the chart,
 * and a second-theme preview, where the point is to see the chart as somebody
 * with the other appearance will.
 *
 * The mode is a prop rather than the reader's own setting, which is the whole
 * reason this exists. A chart checked only in the appearance its author
 * happens to use is a chart nobody checked in the other one — and half the
 * readers are in the other one.
 *
 * It paints its own surface, because a dark chart on a light card is not a
 * preview of anything: the axis labels are chosen to sit on the dark ground
 * this draws, and floating them on white would be a lie about how they read.
 */

import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { ChartPanel } from "@/api/dashboard";
import { useAppearance } from "@/theme/AppearanceProvider";
import { buildChartTheme } from "@/theme/echarts";

import { buildOption } from "./options";

export function ChartPreview({
  panel,
  mode,
  height = 200,
  label,
  compact = false,
}: {
  panel: ChartPanel | undefined;
  /** The appearance to draw in. Defaults to the reader's own. */
  mode?: "light" | "dark";
  height?: number;
  /** A caption naming what is being previewed, for anybody not seeing colour. */
  label?: string;
  /** Strip every label: at thumbnail size the words are noise, not reading. */
  compact?: boolean;
}) {
  const appearance = useAppearance();
  const drawn = mode ?? appearance.mode;
  const option = useMemo(() => {
    if (!panel) return null;
    const full = buildOption(panel, buildChartTheme(drawn, appearance.density));
    return compact ? stripped(full) : full;
  }, [panel, drawn, appearance.density, compact]);

  return (
    <figure className={`nu-chart-preview nu-chart-preview--${drawn}`} style={{ margin: 0 }}>
      {option ? (
        <ReactECharts
          option={option}
          style={{ height, width: "100%" }}
          opts={{ renderer: "canvas" }}
          notMerge
          lazyUpdate
        />
      ) : (
        <div className="nu-chart-preview-empty" style={{ height }} />
      )}
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

/**
 * The same chart with every word taken out.
 *
 * A thumbnail is 104 pixels tall. Seven category labels, a legend and an axis
 * title do not fit in it — they overlap into a grey smear that hides the one
 * thing the thumbnail is for, which is the *shape*. So the text goes and the
 * marks stay, and the name underneath says which kind it is.
 *
 * Done here rather than in `buildOption` because it is a fact about the size
 * this is drawn at, not about the chart: the same option at full size wants
 * every one of those labels.
 */
function stripped(option: Record<string, unknown>): Record<string, unknown> {
  const axis = (value: unknown) => {
    if (!value || typeof value !== "object") return value;
    return { ...value, name: "", axisLabel: { show: false } };
  };
  const series = Array.isArray(option["series"])
    ? (option["series"] as Record<string, unknown>[]).map((item) => ({
        ...item,
        label: { show: false },
        // A gauge carries its own text — the big number, the caption under it
        // and the scale around the arc — none of which is on an axis this
        // function can reach. At thumbnail size the arc alone is the shape.
        ...(item["type"] === "gauge"
          ? {
              detail: { show: false },
              title: { show: false },
              axisLabel: { show: false },
              splitLine: { show: false },
            }
          : {}),
      }))
    : option["series"];

  return {
    ...option,
    animation: false,
    title: { show: false },
    legend: { show: false },
    tooltip: { show: false },
    visualMap: option["visualMap"] ? { ...option["visualMap"], show: false } : undefined,
    grid: { left: 6, right: 6, top: 6, bottom: 6, containLabel: false },
    xAxis: axis(option["xAxis"]),
    yAxis: axis(option["yAxis"]),
    // A radar's axis names are drawn by the radar itself, not by an axis.
    radar: option["radar"]
      ? { ...option["radar"], axisName: { show: false }, radius: "70%" }
      : undefined,
    series,
  };
}
