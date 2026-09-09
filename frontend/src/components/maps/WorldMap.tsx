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
 */

import * as echarts from "echarts/core";
import { MapChart, ScatterChart } from "echarts/charts";
import { GeoComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import ReactECharts from "echarts-for-react/lib/core";
import { format } from "echarts";
import { useMemo } from "react";

import type { MapBucket, MapPoint } from "@/api/maps";
import { useAppearance } from "@/theme/AppearanceProvider";
import { ACCENT, INK, NEUTRAL, PAPER, SEMANTIC_INK } from "@/theme/tokens";
import { compactNumber } from "@/components/charts/options";

import world from "@/assets/world-110m.geo.json";

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

  const option = useMemo(() => {
    const land = dark ? INK[750] : NEUTRAL[100];
    const border = dark ? INK[650] : NEUTRAL[300];
    const text = dark ? INK[200] : NEUTRAL[800];
    const biggest = Math.max(...points.map((point) => point.value), 1);
    // Countries are keyed by what the *map* calls them, not by what the
    // records call them — the two differ for the United States, and a
    // mismatch is a country that stays the colour of "nothing here".
    const shaded = countries.map((country) => ({ name: country.name, value: country.value }));
    const most = Math.max(...shaded.map((item) => item.value), 1);

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: dark ? INK[750] : PAPER,
        borderColor: border,
        textStyle: { color: text },
        formatter: (params: { data?: unknown; name?: string; seriesType?: string }) => {
          const point = params.data as (MapPoint & { value: number[] }) | undefined;
          if (params.seriesType === "scatter" && point?.city) {
            return `<strong>${format.encodeHTML(point.city)}</strong><br/>${format.encodeHTML(
              point.country,
            )}<br/>${format.encodeHTML(unit)} ${compactNumber(point.rows === point.value ? point.rows : point.value)}`;
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
        // Opens on the northern hemisphere, where this dataset lives, and
        // pans and zooms from there. A world map that opens on the whole
        // globe spends most of its panel on ocean.
        zoom: 2.4,
        center: [8, 38],
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
          type: "scatter",
          coordinateSystem: "geo",
          symbolSize: (value: number[]) =>
            7 + Math.sqrt(Math.max(value[2] ?? 0, 0) / biggest) * 26,
          itemStyle: {
            color: SEMANTIC_INK[dark ? "dark" : "light"].info,
            opacity: 0.85,
            borderColor: dark ? INK[900] : PAPER,
            borderWidth: 1,
          },
          data: points.map((point) => ({
            ...point,
            value: [point.longitude, point.latitude, point.value],
          })),
          emphasis: { scale: 1.2 },
          z: 5,
        },
      ],
    };
  }, [points, countries, unit, dark]);

  return (
    <ReactECharts
      echarts={echarts}
      option={option}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate
      onEvents={{
        click: (params: { seriesType?: string; data?: unknown; name?: string }) => {
          const point = params.data as MapPoint | undefined;
          if (params.seriesType === "scatter" && point?.city) onSelectCity?.(point.city);
          else if (params.name) onSelectCountry?.(params.name);
        },
      }}
    />
  );
}
