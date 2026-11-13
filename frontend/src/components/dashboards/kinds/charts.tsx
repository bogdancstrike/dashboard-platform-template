/** The chart kinds: a shape, from a dataset the reader may read. */

import {
  AreaChartOutlined,
  BarChartOutlined,
  DotChartOutlined,
  GlobalOutlined,
  LineChartOutlined,
  PieChartOutlined,
} from "@ant-design/icons";

import type { WidgetKind } from "@/api/dashboards";
import { SERIES } from "@/theme/tokens";

import type { KindSpec } from "./spec";

export const CHART_KINDS = {
  CHART: {
    label: "Chart",
    question: "Any picture the chart builder draws — you pick which.",
    icon: <AreaChartOutlined />,
    colour: SERIES[1],
    family: "chart",
    maximum: 8,
    needs: "dataset",
    page: "/charts/builder",
  },
  LINE_CHART: {
    label: "Line",
    question: "Which way is this going?",
    icon: <LineChartOutlined />,
    colour: SERIES[1],
    family: "chart",
    maximum: 6,
    needs: "dataset",
  },
  AREA_CHART: {
    label: "Area",
    question: "Which way, and how much of it is there?",
    icon: <AreaChartOutlined />,
    colour: SERIES[6],
    family: "chart",
    maximum: 6,
    needs: "dataset",
  },
  BAR_CHART: {
    label: "Bars",
    question: "How do these compare?",
    icon: <BarChartOutlined />,
    colour: SERIES[3],
    family: "chart",
    maximum: 6,
    needs: "dataset",
  },
  PIE_CHART: {
    label: "Share",
    question: "What share is each?",
    icon: <PieChartOutlined />,
    colour: SERIES[5],
    family: "chart",
    maximum: 4,
    needs: "dataset",
  },
  HEATMAP: {
    label: "Heatmap",
    question: "Where do two dimensions concentrate?",
    icon: <DotChartOutlined />,
    colour: SERIES[9],
    family: "chart",
    maximum: 3,
    needs: "dataset",
  },
  MAP: {
    label: "Map",
    question: "Where in the world is it?",
    icon: <GlobalOutlined />,
    colour: SERIES[6],
    family: "chart",
    maximum: 2,
    needs: "dataset",
    page: "/maps",
  },
} satisfies Partial<Record<WidgetKind, KindSpec>>;
