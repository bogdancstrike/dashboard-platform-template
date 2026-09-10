/**
 * What each widget kind is, in one place (§45).
 *
 * The picker, the configure drawer and the gallery card all need the same
 * facts about a kind — what to call it, what question it answers, what it
 * needs naming, and how to draw it small. Three copies of that list is three
 * places to forget a kind, and the one that forgets it is the one somebody
 * uses.
 *
 * The record is keyed on the whole `WidgetKind` union, so a kind added to the
 * server without being described here fails to compile rather than appearing
 * as a blank card.
 *
 * **A kind belongs to a family, and the families are what a reader browses.**
 * Twenty-six cards in one undifferentiated grid is a wall; the same
 * twenty-six under *Numbers · Charts · Records · Your modules · Saved* is a
 * short list four times. The families are also the honest description of what
 * these are: the first three ask a dataset a question, the fourth puts a page
 * of the product on the grid, and the fifth draws something you already made.
 */

import {
  AlertOutlined,
  AreaChartOutlined,
  BarChartOutlined,
  BellOutlined,
  BranchesOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  DashboardOutlined,
  DotChartOutlined,
  FieldTimeOutlined,
  FileSearchOutlined,
  FolderOpenOutlined,
  FundOutlined,
  FundProjectionScreenOutlined,
  GlobalOutlined,
  HeartOutlined,
  LineChartOutlined,
  MailOutlined,
  NotificationOutlined,
  NumberOutlined,
  PieChartOutlined,
  SearchOutlined,
  SlidersOutlined,
  TableOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { ReactNode } from "react";

import type { WidgetKind } from "@/api/dashboards";
import { SEMANTIC, SERIES } from "@/theme/tokens";

/** The families a reader browses, in the order they are offered. */
export const KIND_FAMILIES = ["number", "chart", "records", "module", "saved"] as const;
export type KindFamily = (typeof KIND_FAMILIES)[number];

export const FAMILY_LABELS: Record<KindFamily, { label: string; hint: string }> = {
  number: { label: "Numbers", hint: "One figure, read at a glance." },
  chart: { label: "Charts", hint: "A shape, from a dataset you may read." },
  records: { label: "Records", hint: "The rows themselves, a few at a time." },
  module: {
    label: "Your modules",
    hint: "A page of the product, in miniature — answered by that page's own endpoint.",
  },
  saved: { label: "Things you saved", hint: "Drawn as you left them, not rebuilt." },
};

export interface KindSpec {
  label: string;
  /** The question it answers, in the words somebody would ask it. */
  question: string;
  icon: ReactNode;
  /** Its colour in the picker. Decoration there, and only there. */
  colour: string;
  /** Which shelf of the picker it sits on. */
  family: KindFamily;
  /** How many of one kind on a dashboard stops being useful. */
  maximum: number;
  /** Whether it names a dataset, a saved thing, or nothing at all. */
  needs: "dataset" | "report" | "search" | "nothing";
  /** Where the reader would go to see the whole of it. Modules have a page. */
  page?: string;
}

export const KINDS: Record<WidgetKind, KindSpec> = {
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
  LIST: {
    label: "Newest records",
    question: "What arrived most recently?",
    icon: <UnorderedListOutlined />,
    colour: SERIES[2],
    family: "records",
    maximum: 6,
    needs: "dataset",
  },
  TABLE: {
    label: "Table",
    question: "The rows themselves, a few at a time.",
    icon: <TableOutlined />,
    colour: SERIES[8],
    family: "records",
    maximum: 4,
    needs: "dataset",
  },
  ALERTS: {
    label: "Needs attention",
    question: "What is wrong right now?",
    icon: <AlertOutlined />,
    colour: SEMANTIC.danger,
    family: "records",
    maximum: 1,
    needs: "nothing",
  },
  ACTIVITY: {
    label: "Recent activity",
    question: "Who did what, lately?",
    icon: <FieldTimeOutlined />,
    colour: SEMANTIC.info,
    family: "records",
    maximum: 1,
    needs: "nothing",
    page: "/activity",
  },

  // ── the modules ────────────────────────────────────────────────────────
  // Each is answered by the endpoint its page reads, under its page's
  // permission, and links back to that page. A widget is the page in
  // miniature — never a second implementation of it.
  TASKS: {
    label: "Tasks",
    question: "What is in flight, and which lane is it piled up in?",
    icon: <CheckSquareOutlined />,
    colour: SERIES[0],
    family: "module",
    maximum: 3,
    needs: "nothing",
    page: "/tasks",
  },
  MAIL: {
    label: "Mail",
    question: "What is waiting in the inbox?",
    icon: <MailOutlined />,
    colour: SERIES[1],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/mail",
  },
  FILES: {
    label: "Files",
    question: "What has been uploaded lately?",
    icon: <FolderOpenOutlined />,
    colour: SERIES[7],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/files",
  },
  NOTIFICATIONS: {
    label: "Notifications",
    question: "What has the platform told me?",
    icon: <BellOutlined />,
    colour: SERIES[3],
    family: "module",
    maximum: 1,
    needs: "nothing",
    page: "/notifications",
  },
  PROJECTS: {
    label: "Projects",
    question: "How is delivery going, project by project?",
    icon: <FundProjectionScreenOutlined />,
    colour: SERIES[5],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/projects",
  },
  ANNOUNCEMENTS: {
    label: "Announcements",
    question: "What has been announced to everybody?",
    icon: <NotificationOutlined />,
    colour: SEMANTIC.warning,
    family: "module",
    maximum: 1,
    needs: "nothing",
    page: "/announcements",
  },
  EXPLORER: {
    label: "Data explorer",
    question: "The questions I saved, with today's answer beside each.",
    icon: <SearchOutlined />,
    colour: SERIES[9],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/explore",
  },
  RELATIONSHIPS: {
    label: "Relationships",
    question: "Which records everything else hangs off.",
    icon: <BranchesOutlined />,
    colour: SERIES[6],
    family: "module",
    maximum: 1,
    needs: "nothing",
    page: "/find/relationships",
  },
  FAVORITES: {
    label: "Favourites",
    question: "The places I keep coming back to.",
    icon: <HeartOutlined />,
    colour: SERIES[4],
    family: "module",
    maximum: 1,
    needs: "nothing",
    page: "/favorites",
  },
  CALENDAR: {
    label: "Calendar",
    question: "What is coming up, and who has not answered?",
    icon: <CalendarOutlined />,
    colour: SERIES[2],
    family: "module",
    maximum: 2,
    needs: "nothing",
    page: "/calendar",
  },

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
};

/** The kinds in the order a person browses them, family by family. */
export const KIND_ORDER: WidgetKind[] = [
  // Numbers
  "KPI",
  "GAUGE",
  "ANALYTICS",
  // Charts
  "CHART",
  "BAR_CHART",
  "LINE_CHART",
  "AREA_CHART",
  "PIE_CHART",
  "HEATMAP",
  "MAP",
  // Records
  "LIST",
  "TABLE",
  "ALERTS",
  "ACTIVITY",
  // Modules
  "TASKS",
  "PROJECTS",
  "MAIL",
  "CALENDAR",
  "NOTIFICATIONS",
  "ANNOUNCEMENTS",
  "FILES",
  "EXPLORER",
  "RELATIONSHIPS",
  "FAVORITES",
  // Saved
  "REPORT",
  "SEARCH",
];

/** The kinds of one family, in browsing order. */
export function kindsOf(family: KindFamily, available: WidgetKind[]): WidgetKind[] {
  return KIND_ORDER.filter(
    (kind) => KINDS[kind].family === family && available.includes(kind),
  );
}
