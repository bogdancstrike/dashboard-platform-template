/** The world outline, registered with ECharts once per page load, and the modules the map draws with. */

import * as echarts from "echarts/core";
import { MapChart, ScatterChart } from "echarts/charts";
import { GeoComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import world from "@/assets/world-110m.geo.json";

/** The name the map is registered under. Registration is once per page load. */
export const MAP_NAME = "nucleus-world";

echarts.use([
  MapChart,
  ScatterChart,
  GeoComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
echarts.registerMap(MAP_NAME, world as Parameters<typeof echarts.registerMap>[1]);

export { echarts };
