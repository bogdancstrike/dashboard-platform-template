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

import ReactECharts from "echarts-for-react/lib/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MapBucket, MapPoint } from "@/api/maps";
import { useAppearance } from "@/theme/AppearanceProvider";

import { clusterMarkers, type Cluster, type Placed } from "./cluster";
import { echarts } from "./registerWorld";
import { worldMapOption } from "./worldMapOption";

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

export function WorldMap({
  points,
  countries,
  unit,
  height = 460,
  onSelectCountry,
  onSelectCity,
  focus,
}: {
  points: MapPoint[];
  countries: MapBucket[];
  /** How the measured number reads — "Revenue", "Devices". */
  unit: string;
  height?: number;
  onSelectCountry?: (country: MapPoint["country"]) => void;
  onSelectCity?: (city: string) => void;
  /**
   * Somewhere to fly to — a place chosen in the list beside the map. A new
   * object each time it is chosen, so choosing the same place twice after
   * panning away still flies back.
   */
  focus?: { longitude: number; latitude: number; zoom?: number } | null;
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
  useEffect(() => {
    if (focus) setView({ zoom: focus.zoom ?? 7, center: [focus.longitude, focus.latitude] });
  }, [focus]);
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

  const option = useMemo(
    () => worldMapOption({ countries, unit, dark, singles, merged, symbolSize, view }),
    [countries, unit, dark, singles, merged, symbolSize, view],
  );

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
          {hidden} places are too close together to draw separately at this zoom, and are shown as{" "}
          {merged.length} {merged.length === 1 ? "bubble" : "bubbles"}. Zoom in, or click one, to
          separate them.
        </p>
      )}
    </>
  );
}
