import type { DashboardWidget, WidgetInput, WidgetKind } from "@/api/dashboards";

/** The configure form's values: whatever the fields hold, by name. */
export type FormValues = Record<string, string | boolean | number>;

/** What the form starts from: the widget being edited, or a fresh one of `kind`. */
export function initialValues(
  widget: DashboardWidget | null,
  kind: WidgetKind,
  datasets: { key: string }[],
): FormValues {
  return {
    kind: widget?.kind ?? kind,
    title: widget?.title ?? "",
    subtitle: widget?.subtitle ?? "",
    entity: widget?.config.entity ?? datasets[0]?.key ?? "",
    dimension: widget?.config.dimension ?? "",
    stack: widget?.config.stack ?? "",
    period: widget?.config.period ?? "",
    chart: widget?.config.chart ?? "bar",
    metric: widget?.config.metric ?? "",
    report_id: widget?.config.report_id ?? "",
    search_id: widget?.config.search_id ?? "",
    insight_id: widget?.config.insight_id ?? "",
    // Module options. Every one of them optional, because a module widget with
    // nothing said is complete — it shows the module's own default view.
    board_id: widget?.config.board_id ?? "",
    folder: widget?.config.folder ?? "INBOX",
    folder_id: widget?.config.folder_id ?? "",
    unread_only: widget?.config.unread_only ?? false,
    category: widget?.config.category ?? "",
    status: widget?.config.status ?? "",
    view: widget?.config.view ?? "bookmarks",
    days: widget?.config.days ?? 7,
  };
}

/**
 * The config a form's values make, for the kind that was chosen.
 *
 * Keyed on the kind rather than sending everything, because the server refuses
 * a dataset on a feed and a dataset on a reference — both would be a second
 * opinion about where the widget's data comes from. Anything a kind does not
 * read is left out here rather than dropped there, so what is stored is what
 * the form actually asked.
 */
export function configFor(kind: WidgetKind, values: FormValues): WidgetInput["config"] {
  const text = (key: string) => {
    const value = values[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const flag = (key: string) => (values[key] ? true : undefined);
  const only = <T>(entries: Record<string, T | undefined>) =>
    Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

  switch (kind) {
    case "REPORT":
      return { report_id: String(values["report_id"] ?? "") };
    case "SEARCH":
      return { search_id: String(values["search_id"] ?? "") };
    case "INSIGHT":
      return { insight_id: String(values["insight_id"] ?? "") };
    case "TASKS":
      return only({ board_id: text("board_id"), status: text("status") });
    case "MAIL":
      return only({ folder: text("folder"), unread_only: flag("unread_only") });
    case "FILES":
      return only({ folder_id: text("folder_id") });
    case "NOTIFICATIONS":
      return only({ category: text("category"), unread_only: flag("unread_only") });
    case "ANNOUNCEMENTS":
      return only({ category: text("category") });
    case "PROJECTS":
      return only({ status: text("status") });
    case "CALENDAR":
      return only({ days: Number(values["days"] ?? 7) });
    case "FAVORITES":
      return only({ view: text("view") });
    case "EXPLORER":
    case "RELATIONSHIPS":
      return only({ entity: text("entity") });
    case "ALERTS":
    case "ACTIVITY":
      return {};
    default:
      // The dataset kinds. Every optional part omitted when empty, so a widget
      // that named no grouping keeps taking the dataset's declared default
      // rather than freezing today's answer into its config.
      return only({
        entity: text("entity"),
        metric: text("metric"),
        dimension: text("dimension"),
        stack: text("stack"),
        period: text("period"),
        chart: kind === "CHART" ? text("chart") : undefined,
      });
  }
}
