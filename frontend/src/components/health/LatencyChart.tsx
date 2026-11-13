/**
 * A dependency's latency across a window, on a real time axis (§24).
 *
 * Drawn here rather than through the generic `ChartPreview` because that one
 * treats every x value as a *category*: forty readings became forty rotated
 * date labels smeared into one grey pile, and four-digit latencies stacked
 * their ticks on top of each other. Time is continuous, so the axis is `time`
 * and ECharts places a few readable ticks itself.
 *
 * Two sizes, one drawing. The card's sparkline keeps two clock ticks and two
 * latency ticks — enough to read "about 200 ms, this afternoon" — and the
 * detail view gets the full axis, a tooltip and the periods of trouble shaded.
 */

import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

import type { HealthIncident, HealthPoint } from "@/api/meta";
import { useAppearance } from "@/theme/AppearanceProvider";
import { buildChartTheme } from "@/theme/echarts";

import { clock, dayName, latency, niceCeiling, shortWhen } from "./when";

export function LatencyChart({
  points,
  incidents = [],
  height,
  detailed = false,
  label,
}: {
  points: HealthPoint[];
  incidents?: HealthIncident[];
  height: number;
  /** The full axis, a tooltip and shaded incidents; otherwise a sparkline. */
  detailed?: boolean;
  /** What the chart shows, for anybody not seeing it. */
  label: string;
}) {
  const { mode, density } = useAppearance();
  const option = useMemo(() => {
    const theme = buildChartTheme(mode, density);
    const text = theme.textStyle.color;
    const grid = mode === "dark" ? "rgba(243, 231, 210, 0.08)" : "rgba(27, 30, 38, 0.07)";
    const bad = mode === "dark" ? "rgba(233, 119, 111, 0.16)" : "rgba(217, 72, 59, 0.10)";
    const warn = mode === "dark" ? "rgba(227, 174, 106, 0.16)" : "rgba(217, 154, 43, 0.12)";
    const data = points.map((point) => [
      new Date(point.at).valueOf(),
      Math.round(point.latency_ms),
      point.status,
    ]);
    const top = niceCeiling(Math.max(1, ...points.map((point) => point.latency_ms)));
    const spanDays =
      points.length > 1
        ? (new Date(points[points.length - 1]!.at).valueOf() - new Date(points[0]!.at).valueOf()) /
          86_400_000
        : 0;

    return {
      animation: false,
      textStyle: {
        fontFamily: theme.textStyle.fontFamily,
        fontSize: detailed ? 12 : 11,
        color: text,
      },
      grid: detailed
        ? { left: 8, right: 16, top: 16, bottom: 8, containLabel: true }
        : { left: 2, right: 4, top: 8, bottom: 2, containLabel: true },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (params: { value: [number, number, string] }[]) => {
          const [at, ms, status] = params[0]!.value;
          return `<b>${shortWhen(new Date(at).toISOString())}</b><br/>${latency(ms)} · ${String(status).toLowerCase()}`;
        },
      },
      xAxis: {
        type: "time",
        splitNumber: detailed ? 6 : 2,
        axisLine: { lineStyle: { color: grid } },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: {
          // The card's sparkline names its ends under the status band
          // instead: two words there read better than a crowded axis here.
          show: detailed,
          color: text,
          hideOverlap: true,
          showMinLabel: !detailed,
          showMaxLabel: !detailed,
          // A day's window reads in clock times; a week or a month in days.
          formatter: (value: number) => {
            const moment = new Date(value);
            if (spanDays > 2)
              return detailed ? `${dayName(moment)} ${clock(moment)}` : dayName(moment);
            return clock(moment);
          },
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        // The sparkline keeps two ticks, nought and a round ceiling, so
        // four-digit values never stack on top of each other.
        ...(detailed ? { splitNumber: 4 } : { max: top, interval: top }),
        axisLabel: { color: text, formatter: (value: number) => latency(value) },
        splitLine: { lineStyle: { color: grid } },
      },
      series: [
        {
          type: "line",
          data,
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { width: detailed ? 2 : 1.6, color: theme.accent },
          areaStyle: { color: theme.accent, opacity: 0.12 },
          markArea: detailed
            ? {
                silent: true,
                data: incidents.map((incident) => [
                  {
                    xAxis: new Date(incident.started_at).valueOf(),
                    itemStyle: { color: incident.status === "UNAVAILABLE" ? bad : warn },
                  },
                  { xAxis: new Date(incident.ended_at).valueOf() },
                ]),
              }
            : undefined,
        },
      ],
    };
  }, [points, incidents, detailed, mode, density]);

  return (
    <figure className="nx-hl-chart" style={{ margin: 0 }} aria-label={label} role="img">
      <ReactECharts
        option={option}
        style={{ height, width: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
        lazyUpdate
      />
    </figure>
  );
}
