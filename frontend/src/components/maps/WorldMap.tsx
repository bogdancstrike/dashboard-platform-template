/**
 * Where the records are (§44, §61).
 *
 * One picture carrying two layers, because they answer two halves of one
 * question. The **choropleth** shades each country by what was measured there,
 * which is how somebody sees that Germany is twice France without reading a
 * number. The **markers** sit on the cities themselves, sized by the same
 * measure, because a country is not where anybody actually is — a customer is
 * in Munich, and a shaded Germany hides whether that is Munich or Berlin.
 *
 * Three decisions worth stating.
 *
 * **The country outlines are vendored, not fetched.** The stack runs offline
 * behind `docker compose up`, and a map that is blank without a CDN is blank
 * in exactly the environment this template exists to demonstrate. See
 * `src/assets/README.md` for the provenance.
 *
 * **A country the map has no polygon for still gets its marker.** Singapore is
 * below the resolution of a 1:110 000 000 world, so it has no shape to shade —
 * but it has a coordinate, and a dot is drawn there. Dropping the record
 * because the basemap is coarse would be the map deciding what the data says.
 *
 * **Colour carries the measure and nothing else.** The land is neutral; only
 * countries with records take the accent ramp, so an unshaded country reads as
 * "none here" rather than as decoration.
 *
 * **Markers that would overlap are drawn as one, and split when you zoom in**
 * (§50). At the zoom this opens on, Amsterdam, Brussels and London are one
 * smear with three tooltips fighting over the same twenty pixels — and that is
 * true of thirty cities, not only of three thousand. The rule is screen
 * distance (`cluster.ts`), asked of the projection ECharts is actually using,
 * so it needs no threshold tuned against a particular dataset size.
 */

import * as echarts from "echarts/core";
import { MapChart, ScatterChart } from "echarts/charts";
import { GeoComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import ReactECharts from "echarts-for-react/lib/core";
import { format } from "echarts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MapBucket, MapPoint } from "@/api/maps";
import { useAppearance } from "@/theme/AppearanceProvider";
import { ACCENT, INK, NEUTRAL, PAPER, SEMANTIC_INK } from "@/theme/tokens";
import { compactNumber } from "@/components/charts/options";
import { clusterMarkers, describeCluster, type Cluster, type Placed } from "./cluster";

import world from "@/assets/world-110m.geo.json";

/**
 * The two things this component asks of a live chart.
 *
 * Typed as what is used rather than as `ECharts`: `echarts-for-react` hands
 * back the instance typed from its own copy of the echarts declarations, and
 * the two classes differ by a private field.
 */
interface ProjectingChart {
  convertToPixel(finder: { geoIndex: number }, value: number[]): number[] | undefined;
  getOption(): unknown;
}

/** The name the map is registered under. Registration is once per page load. */
const MAP_NAME = "nucleus-world";

echarts.use([
  MapChart,
  ScatterChart,
  GeoComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
echarts.registerMap(MAP_NAME, world as Parameters<typeof echarts.registerMap>[1]);

export function WorldMap({
  points,
  countries,
  unit,
  height = 460,
  onSelectCountry,
  onSelectCity,
}: {
  points: MapPoint[];
  countries: MapBucket[];
  /** How the measured number reads — "Revenue", "Devices". */
  unit: string;
  height?: number;
  onSelectCountry?: (country: MapPoint["country"]) => void;
  onSelectCity?: (city: string) => void;
}) {
  const { mode } = useAppearance();
  const dark = mode === "dark";

  // `ReactECharts` hands back the instance typed from its own copy of the
  // echarts types, which is a structurally identical class with a private
  // field — hence the shape this needs rather than `ECharts`.
  const chart = useRef<ProjectingChart | null>(null);
  /**
   * The view, held here rather than left to ECharts.
   *
   * The option is rebuilt whenever the clustering changes, and `notMerge`
   * would snap the map back to its opening view every time — so wherever the
   * reader has panned to *is* state, updated from the chart on every roam and
   * fed back in.
   */
  const [view, setView] = useState<{ zoom: number; center: [number, number] }>({
    // Opens on the northern hemisphere, where this dataset lives. A world map
    // that opens on the whole globe spends most of its panel on ocean.
    zoom: 2.4,
    center: [8, 38],
  });
  /** Bumped when the projection has changed, to re-cluster against it. */
  const [projection, setProjection] = useState(0);
  /**
   * Whether the last pass actually had a projection to ask.
   *
   * `convertToPixel` answers `null` until the geo component has been laid
   * out, and it is *still* null inside `onChartReady` — which is why the
   * first version of this clustered nothing until the reader happened to pan.
   * So the pass is retried when a render finishes, and this is what stops
   * that from being a loop: once a projection exists, no more retries.
   */
  const projected = useRef(false);

  const biggest = Math.max(...points.map((point) => point.value), 1);
  /** The diameter a marker is drawn at, which is what decides overlap. */
  const symbolSize = useCallback(
    (value: number) => 7 + Math.sqrt(Math.max(value, 0) / biggest) * 26,
    [biggest],
  );

  /**
   * The markers, merged where they would overlap on *this* view.
   *
   * Projected through ECharts' own geo transform, so the rule is asked of the
   * pixels the reader is actually looking at. Before the chart exists there is
   * no projection to ask, and every city stands alone for that one frame —
   * which is the honest answer to "where would these be drawn" when nothing
   * has been drawn yet.
   */
  const clusters = useMemo<Cluster[]>(() => {
    void projection;
    void view;
    const instance = chart.current;
    if (!instance) {
      return points.map((point) => ({
        points: [point],
        longitude: point.longitude,
        latitude: point.latitude,
        value: point.value,
        rows: point.rows,
      }));
    }
    const placed: Placed[] = [];
    for (const point of points) {
      const at = instance.convertToPixel({ geoIndex: 0 }, [point.longitude, point.latitude]);
      if (!Array.isArray(at)) continue;
      placed.push({
        point,
        x: at[0] as number,
        y: at[1] as number,
        radius: symbolSize(point.value) / 2,
      });
    }
    projected.current = placed.length > 0;
    return clusterMarkers(placed);
  }, [points, symbolSize, projection, view]);

  const singles = clusters.filter((cluster) => cluster.points.length === 1);
  const merged = clusters.filter((cluster) => cluster.points.length > 1);

  const option = useMemo(() => {
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
  }, [countries, unit, dark, singles, merged, symbolSize, view]);

  /**
   * Wait for the geo layout, then cluster against it.
   *
   * `convertToPixel` answers `null` until the geo component has been laid out,
   * and it is still null inside `onChartReady` and inside the first `finished`
   * — `lazyUpdate` defers the option to a later frame. The first version of
   * this therefore clustered nothing until the reader happened to pan the map,
   * which is a feature that works only for people who did not need it.
   *
   * So: retry once a frame until there is a projection, and stop. Bounded, so
   * a canvas that will never have one — jsdom, a hidden tab — costs ten frames
   * and not a spin.
   */
  useEffect(() => {
    if (projected.current) return undefined;
    let frames = 0;
    let handle = 0;
    const attempt = () => {
      if (projected.current || frames >= 10) return;
      frames += 1;
      setProjection((count) => count + 1);
      handle = window.requestAnimationFrame(attempt);
    };
    handle = window.requestAnimationFrame(attempt);
    return () => window.cancelAnimationFrame(handle);
  }, [points]);

  /** Where the chart is now, so the next option keeps it. */
  const remember = useCallback(() => {
    const instance = chart.current;
    if (!instance) return;
    const geo = (instance.getOption() as { geo?: { zoom?: number; center?: number[] }[] }).geo?.[0];
    if (!geo?.center || typeof geo.zoom !== "number") return;
    setView({ zoom: geo.zoom, center: [geo.center[0] ?? 8, geo.center[1] ?? 38] });
  }, []);

  const hidden = merged.reduce((sum, cluster) => sum + cluster.points.length, 0);

  return (
    <>
      <ReactECharts
      echarts={echarts}
      option={option}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
      onChartReady={(instance) => {
        chart.current = instance;
        // Now there is a projection to cluster against.
        setProjection((count) => count + 1);
      }}
      onEvents={{
        georoam: () => remember(),
        click: (params: { seriesType?: string; data?: unknown; name?: string }) => {
          const cluster = (params.data as { cluster?: Cluster } | undefined)?.cluster;
          if (cluster && cluster.points.length > 1) {
            // Zooming in *is* the answer to "which of these did you mean":
            // the bubble splits into the cities it was hiding, and each of
            // those opens its own list. Picking one from a menu would be the
            // map asking the reader to choose blind.
            setView({
              zoom: Math.min(view.zoom * 1.9, 40),
              center: [cluster.longitude, cluster.latitude],
            });
            return;
          }
          const city = cluster?.points[0]?.city;
          if (city) onSelectCity?.(city);
          else if (params.name) onSelectCountry?.(params.name);
        },
      }}
      />
      {/* What the picture is hiding, on the picture — the same rule the
          "cannot be placed" sentence follows (§34). A map that quietly draws
          twelve cities as four bubbles has answered a different question from
          the table beside it, and the reader has no way to know. */}
      {merged.length > 0 && (
        <p className="nu-map-note" data-testid="map-clustered">
          {hidden} places are too close together to draw separately at this
          zoom, and are shown as {merged.length}{" "}
          {merged.length === 1 ? "bubble" : "bubbles"}. Zoom in, or click one,
          to separate them.
        </p>
      )}
    </>
  );
}
