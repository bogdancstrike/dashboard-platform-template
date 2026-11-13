/**
 * Which body draws each widget kind (§45).
 *
 * A record keyed on the whole `WidgetKind` union rather than a chain of `if`s
 * for the same reason `KINDS` is one: a kind added to the server without a body
 * here fails to compile instead of rendering an empty card somebody has to
 * debug.
 *
 * `subject` says whether the kind draws a dataset, report, search or insight
 * the reader has to choose. A module widget is about a *page*, and the alert
 * strip and activity feed about the whole platform, so they need nothing
 * chosen to be complete.
 */

import type { ReactNode } from "react";

import type { AnalysisCatalogue } from "@/api/analysis";
import type { ChartKind } from "@/api/dashboard";
import type { DashboardWidget, WidgetKind } from "@/api/dashboards";
import type { ExplorerResource } from "@/api/explorer";
import { InsightWidgetBody } from "@/components/insights/InsightWidgetBody";

import { ActivityBody } from "./bodies/ActivityBody";
import { AlertsBody } from "./bodies/AlertsBody";
import { ChartBody } from "./bodies/ChartBody";
import { MapBody } from "./bodies/MapBody";
import { MetricBody } from "./bodies/MetricBody";
import { MetricStripBody } from "./bodies/MetricStripBody";
import { ReportBody } from "./bodies/ReportBody";
import { RowsBody } from "./bodies/RowsBody";
import { SearchBody } from "./bodies/SearchBody";
import {
  AnnouncementsBody,
  CalendarBody,
  ExplorerBody,
  FavoritesBody,
  FilesBody,
  MailBody,
  NotificationsBody,
  ProjectsBody,
  RelationshipsBody,
  TasksBody,
  type ModuleBodyProps,
} from "./modules";
import { WidgetError } from "./WidgetError";

/** What a body may need: the widget, and the catalogue facts about its subject. */
export interface BodyContext {
  widget: DashboardWidget;
  /** The widget's own period, or the dashboard's. */
  period: string;
  dataset: AnalysisCatalogue["datasets"][number] | undefined;
  resource: ExplorerResource | undefined;
  resources: ExplorerResource[];
}

interface BodyEntry {
  /** Whether the kind is unfinished until a subject is chosen. */
  subject: boolean;
  render: (context: BodyContext) => ReactNode;
}

/** A page of the product in miniature; a refusal is drawn in place. */
function module(Body: (props: ModuleBodyProps) => JSX.Element): BodyEntry {
  return {
    subject: false,
    render: ({ widget, resources }) => (
      <Body
        widget={widget}
        resources={resources}
        fallback={(error, subject) => <WidgetError error={error} entity={subject} />}
      />
    ),
  };
}

/** A grouped analysis drawn as `kind`. */
function chart(kind: ChartKind): BodyEntry {
  return {
    subject: true,
    render: ({ widget, dataset, period }) => (
      <ChartBody widget={widget} dataset={dataset} period={period} kind={kind} />
    ),
  };
}

function rows(table: boolean): BodyEntry {
  return {
    subject: true,
    render: ({ widget, resource }) => <RowsBody widget={widget} resource={resource} table={table} />,
  };
}

function metric(gauge: boolean): BodyEntry {
  return { subject: true, render: ({ widget }) => <MetricBody widget={widget} gauge={gauge} /> };
}

export const BODIES: Record<WidgetKind, BodyEntry> = {
  KPI: metric(false),
  GAUGE: metric(true),
  ANALYTICS: { subject: true, render: ({ widget }) => <MetricStripBody widget={widget} /> },
  // A `CHART` names its own picture, so "bar" is only the fallback. That is
  // the whole difference between it and the five fixed chart kinds: the
  // drawing is configuration rather than a kind per shape, which is what lets
  // a treemap or a scatter exist on a dashboard without a `TREEMAP_CHART` on
  // the server.
  CHART: {
    subject: true,
    render: (context) =>
      chart((context.widget.config.chart as ChartKind | undefined) || "bar").render(context),
  },
  LINE_CHART: chart("line"),
  AREA_CHART: chart("area"),
  BAR_CHART: chart("bar"),
  PIE_CHART: chart("pie"),
  HEATMAP: chart("heatmap"),
  MAP: { subject: true, render: ({ widget, period }) => <MapBody widget={widget} period={period} /> },
  LIST: rows(false),
  TABLE: rows(true),
  ALERTS: { subject: false, render: () => <AlertsBody /> },
  ACTIVITY: { subject: false, render: () => <ActivityBody /> },
  TASKS: module(TasksBody),
  PROJECTS: module(ProjectsBody),
  MAIL: module(MailBody),
  FILES: module(FilesBody),
  NOTIFICATIONS: module(NotificationsBody),
  ANNOUNCEMENTS: module(AnnouncementsBody),
  EXPLORER: module(ExplorerBody),
  RELATIONSHIPS: module(RelationshipsBody),
  FAVORITES: module(FavoritesBody),
  CALENDAR: module(CalendarBody),
  REPORT: { subject: true, render: ({ widget, period }) => <ReportBody widget={widget} period={period} /> },
  SEARCH: { subject: true, render: ({ widget, resources }) => <SearchBody widget={widget} resources={resources} /> },
  INSIGHT: { subject: true, render: ({ widget }) => <InsightWidgetBody id={widget.config.insight_id ?? ""} /> },
};
