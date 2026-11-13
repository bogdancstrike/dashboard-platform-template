/** The number kinds: one figure, read at a glance. */

import {
  DashboardOutlined,
  NumberOutlined,
  SlidersOutlined,
} from "@ant-design/icons";

import type { WidgetKind } from "@/api/dashboards";
import { SEMANTIC, SERIES } from "@/theme/tokens";

import type { KindSpec } from "./spec";

export const NUMBER_KINDS = {
  KPI: {
    label: "Headline number",
    question: "One number, big enough to read across a room.",
    icon: <NumberOutlined />,
    colour: SERIES[0],
    family: "number",
    maximum: 8,
    needs: "dataset",
  },
  GAUGE: {
    label: "Gauge",
    question: "How close to target is one number?",
    icon: <DashboardOutlined />,
    colour: SEMANTIC.success,
    family: "number",
    maximum: 4,
    needs: "dataset",
  },
  ANALYTICS: {
    label: "Headline strip",
    question: "Every declared number for a dataset, the way /analytics opens.",
    icon: <SlidersOutlined />,
    colour: SERIES[6],
    family: "number",
    maximum: 4,
    needs: "dataset",
    page: "/analytics",
  },
} satisfies Partial<Record<WidgetKind, KindSpec>>;
