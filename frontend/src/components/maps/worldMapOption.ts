/** The ECharts option for the world map: shaded countries, single markers and cluster bubbles. */

import { format } from "echarts";

import type { MapBucket } from "@/api/maps";
import { compactNumber } from "@/components/charts/options";
import { ACCENT, INK, NEUTRAL, PAPER, SEMANTIC_INK } from "@/theme/tokens";

import { describeCluster, type Cluster } from "./cluster";
import { MAP_NAME } from "./registerWorld";

export interface WorldMapInputs {
  countries: MapBucket[];
  /** How the measured number reads — "Revenue", "Devices". */
  unit: string;
  dark: boolean;
  /** Clusters holding one place, drawn as plain markers. */
  singles: Cluster[];
  /** Clusters holding several, drawn as a counted bubble. */
  merged: Cluster[];
  /** The diameter a marker is drawn at for a value. */
  symbolSize: (value: number) => number;
  view: { zoom: number; center: [number, number] };
}

export function worldMapOption({
  countries,
  unit,
  dark,
  singles,
  merged,
  symbolSize,
  view,
}: WorldMapInputs) {
  const land = dark ? INK[750] : NEUTRAL[100];
  const border = dark ? INK[650] : NEUTRAL[300];
  const text = dark ? INK[200] : NEUTRAL[800];
  const marker = SEMANTIC_INK[dark ? "dark" : "light"].info;
  // Countries are keyed by what the *map* calls them, not by what the
  // records call them — the two differ for the United States, and a
  // mismatch is a country that stays the colour of "nothing here".
  const shaded = countries.map((country) => ({ name: country.name, value: country.value }));
  const most = Math.max(...shaded.map((item) => item.value), 1);

  const reads = (value: number) => `${format.encodeHTML(unit)} ${compactNumber(value)}`;

  return {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      backgroundColor: dark ? INK[750] : PAPER,
      borderColor: border,
      textStyle: { color: text },
      formatter: (params: { data?: unknown; name?: string; seriesType?: string }) => {
        const cluster = (params.data as { cluster?: Cluster } | undefined)?.cluster;
        if (cluster && cluster.points.length > 1) {
          // What it swallowed, by name: a bubble saying only "4" tells the
          // reader they have lost something and not what.
          return (
            `<strong>${cluster.points.length} cities</strong><br/>` +
            `${format.encodeHTML(describeCluster(cluster))}<br/>${reads(cluster.value)}` +
            "<br/><em>Zoom in to separate them</em>"
          );
        }
        const point = cluster?.points[0];
        if (point) {
          return (
            `<strong>${format.encodeHTML(point.city)}</strong><br/>` +
            `${format.encodeHTML(point.country)}<br/>${reads(point.value)}`
          );
        }
        const country = countries.find((item) => item.name === params.name);
        if (!country) return format.encodeHTML(params.name ?? "");
        return `<strong>${format.encodeHTML(country.name)}</strong><br/>${format.encodeHTML(
          unit,
        )} ${compactNumber(country.value)}<br/>${country.cities} ${
          country.cities === 1 ? "city" : "cities"
        }`;
      },
    },
    visualMap: {
      min: 0,
      max: most,
      left: 8,
      bottom: 8,
      calculable: false,
      // One hue: two would read as two categories rather than as more and
      // less of one thing.
      inRange: { color: [dark ? INK[700] : NEUTRAL[200], ACCENT[500]] },
      textStyle: { color: text },
      text: [compactNumber(most), "0"],
    },
    geo: {
      map: MAP_NAME,
      roam: true,
      zoom: view.zoom,
      center: view.center,
      itemStyle: { areaColor: land, borderColor: border, borderWidth: 0.6 },
      emphasis: { itemStyle: { areaColor: land }, label: { show: false } },
      // No projection: longitude and latitude map straight to x and y, which
      // is what the vendored outlines and the gazetteer are already in. The
      // seam-crossing rings that a projection would have cut are cut in
      // `scripts/vendor-world-map.py` instead.
    },
    series: [
      {
        type: "map",
        map: MAP_NAME,
        geoIndex: 0,
        data: shaded,
      },
      {
        name: "cities",
        type: "scatter",
        coordinateSystem: "geo",
        symbolSize: (value: number[]) => symbolSize(value[2] ?? 0),
        itemStyle: {
          color: marker,
          opacity: 0.85,
          borderColor: dark ? INK[900] : PAPER,
          borderWidth: 1,
        },
        data: singles.map((cluster) => ({
          cluster,
          name: cluster.points[0]!.city,
          value: [cluster.longitude, cluster.latitude, cluster.value],
        })),
        emphasis: { scale: 1.2 },
        z: 5,
      },
      {
        name: "clusters",
        type: "scatter",
        coordinateSystem: "geo",
        // Sized by what it holds, so a cluster of the four biggest cities is
        // a bigger bubble than any one of them — which is the same rule the
        // single markers follow.
        symbolSize: (value: number[]) => Math.max(symbolSize(value[2] ?? 0), 22),
        itemStyle: {
          color: marker,
          opacity: 0.92,
          borderColor: dark ? INK[900] : PAPER,
          borderWidth: 2,
        },
        // The count on the face of it: a reader has to be able to see that
        // one bubble is several places without hovering it.
        label: {
          show: true,
          formatter: (params: { data?: unknown }) =>
            String((params.data as { cluster: Cluster }).cluster.points.length),
          color: dark ? INK[900] : PAPER,
          fontSize: 11,
          fontWeight: 700,
        },
        labelLayout: { hideOverlap: false },
        data: merged.map((cluster) => ({
          cluster,
          name: describeCluster(cluster),
          value: [cluster.longitude, cluster.latitude, cluster.value],
        })),
        emphasis: { scale: 1.15 },
        z: 6,
      },
    ],
  };
}
