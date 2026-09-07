/**
 * What each widget kind is, in one place (§45).
 *
 * The picker, the configure drawer and the gallery card all need the same four
 * facts about a kind — what to call it, what question it answers, what it
 * needs naming, and how to draw it small. Three copies of that list is three
 * places to forget a kind, and the one that forgets it is the one somebody
 * uses.
 *
 * The record is keyed on the whole `WidgetKind` union, so a kind added to the
 * server without being described here fails to compile rather than appearing
 * as a blank card.
 */

import {
  AlertOutlined,
  AreaChartOutlined,
  BarChartOutlined,
  DashboardOutlined,
  DotChartOutlined,
  FieldTimeOutlined,
  FileSearchOutlined,
  FundOutlined,
  LineChartOutlined,
  NumberOutlined,
  PieChartOutlined,
  TableOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import type { WidgetKind } from "@/api/dashboards";
import { SEMANTIC, SERIES } from "@/theme/tokens";

export interface KindSpec {
  label: string;
  /** The question it answers, in the words somebody would ask it. */
  question: string;
  icon: ReactNode;
  /** Its colour in the picker. Decoration there, and only there. */
  colour: string;
  /** How many of one kind on a dashboard stops being useful. */
  maximum: number;
  /** Whether it names a dataset, a saved thing, or nothing at all. */
  needs: "dataset" | "report" | "search" | "nothing";
}

export const KINDS: Record<WidgetKind, KindSpec> = {
  KPI: {
    label: "Headline number",
    question: "One number, big enough to read across a room.",
    icon: <NumberOutlined />,
    colour: SERIES[0],
    maximum: 8,
    needs: "dataset",
  },
  GAUGE: {
    label: "Gauge",
    question: "How close to target is one number?",
    icon: <DashboardOutlined />,
    colour: SEMANTIC.success,
    maximum: 4,
    needs: "dataset",
  },
  LINE_CHART: {
    label: "Line",
    question: "Which way is this going?",
    icon: <LineChartOutlined />,
    colour: SERIES[1],
    maximum: 6,
    needs: "dataset",
  },
  AREA_CHART: {
    label: "Area",
    question: "Which way, and how much of it is there?",
    icon: <AreaChartOutlined />,
    colour: SERIES[6],
    maximum: 6,
    needs: "dataset",
  },
  BAR_CHART: {
    label: "Bars",
    question: "How do these compare?",
    icon: <BarChartOutlined />,
    colour: SERIES[3],
    maximum: 6,
    needs: "dataset",
  },
  PIE_CHART: {
    label: "Share",
    question: "What share is each?",
    icon: <PieChartOutlined />,
    colour: SERIES[5],
    maximum: 4,
    needs: "dataset",
  },
  HEATMAP: {
    label: "Heatmap",
    question: "Where do two dimensions concentrate?",
    icon: <DotChartOutlined />,
    colour: SERIES[9],
    maximum: 3,
    needs: "dataset",
  },
  LIST: {
    label: "Newest records",
    question: "What arrived most recently?",
    icon: <UnorderedListOutlined />,
    colour: SERIES[2],
    maximum: 6,
    needs: "dataset",
  },
  TABLE: {
    label: "Table",
    question: "The rows themselves, a few at a time.",
    icon: <TableOutlined />,
    colour: SERIES[8],
    maximum: 4,
    needs: "dataset",
  },
  ALERTS: {
    label: "Needs attention",
    question: "What is wrong right now?",
    icon: <AlertOutlined />,
    colour: SEMANTIC.danger,
    maximum: 1,
    needs: "nothing",
  },
  ACTIVITY: {
    label: "Recent activity",
    question: "Who did what, lately?",
    icon: <FieldTimeOutlined />,
    colour: SEMANTIC.info,
    maximum: 1,
    needs: "nothing",
  },
  REPORT: {
    label: "A saved report",
    question: "One you already built, drawn as it was saved.",
    icon: <FundOutlined />,
    colour: SERIES[7],
    maximum: 8,
    needs: "report",
  },
  SEARCH: {
    label: "A saved search",
    question: "A question you already asked, answered here.",
    icon: <FileSearchOutlined />,
    colour: SERIES[4],
    maximum: 6,
    needs: "search",
  },
};

/** The kinds in the order a person browses them: numbers, shapes, then feeds. */
export const KIND_ORDER: WidgetKind[] = [
  "KPI",
  "GAUGE",
  "BAR_CHART",
  "LINE_CHART",
  "AREA_CHART",
  "PIE_CHART",
  "HEATMAP",
  "LIST",
  "TABLE",
  "ALERTS",
  "ACTIVITY",
  "REPORT",
  "SEARCH",
];
