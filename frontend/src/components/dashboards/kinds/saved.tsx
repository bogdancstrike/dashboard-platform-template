/** The saved kinds: something the reader already made, drawn as they left it. */

import {
  BulbOutlined,
  FileSearchOutlined,
  FundOutlined,
} from "@ant-design/icons";

import type { WidgetKind } from "@/api/dashboards";
import { SERIES } from "@/theme/tokens";

import type { KindSpec } from "./spec";

export const SAVED_KINDS = {
  REPORT: {
    label: "A saved report",
    question: "One you already built, drawn as it was saved.",
    icon: <FundOutlined />,
    colour: SERIES[7],
    family: "saved",
    maximum: 8,
    needs: "report",
    page: "/reports",
  },
  SEARCH: {
    label: "A saved search",
    question: "A question you already asked, answered here.",
    icon: <FileSearchOutlined />,
    colour: SERIES[4],
    family: "saved",
    maximum: 6,
    needs: "search",
    page: "/explore",
  },
  INSIGHT: {
    label: "An insight",
    question: "A page the AI built from your question, with today's numbers.",
    icon: <BulbOutlined />,
    colour: SERIES[5],
    family: "saved",
    maximum: 6,
    needs: "insight",
    page: "/ai/insights",
  },
} satisfies Partial<Record<WidgetKind, KindSpec>>;
