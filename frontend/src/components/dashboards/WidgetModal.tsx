/**
 * Choosing what a widget shows — with the widget drawn beside the form (§45).
 *
 * This was a 420-pixel drawer holding a form, which asked somebody to pick
 * "Heatmap · task · assignee · last 30 days" and then find out what they had
 * made by pressing Add and looking at the grid. Two problems with that, and
 * they compound: a person who does not already know what a heatmap of a
 * dataset looks like cannot choose one, and every correction costs a
 * round trip through a card on a grid they then have to find again.
 *
 * So it is a modal, wide enough for two panes: the choice on the left, and
 * **the widget itself on the right, drawn from live data as it is configured**.
 * The preview is the real `WidgetBody` — not an illustration of one — so what
 * is previewed is what gets added, and a dataset that answers nothing shows
 * that here rather than after the fact.
 *
 * Three decisions worth stating.
 *
 * **The kinds are browsed, not selected from a list.** Twenty-six of them is
 * more than a select is good for, so they are cards on shelves, each carrying
 * the *question it answers* rather than only its name — somebody who does not
 * know what a heatmap is for can still tell whether they want one.
 *
 * **The same modal configures an existing widget.** A preview is worth exactly
 * as much when changing what a card shows as when adding one, and two
 * components would be two vocabularies for one decision.
 *
 * **The preview is debounced by React Query, not by a timer.** Every field
 * change re-renders it, the request key changes only when the *question*
 * does, and an unchanged question is answered from cache — so dragging through
 * six chart kinds costs six draws and one fetch each, not one fetch per
 * keystroke in the title field.
 */

import { useQuery } from "@tanstack/react-query";
import {
  Empty,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Switch,
  Typography,
} from "antd";
import { useState } from "react";

import { analysisApi } from "@/api/analysis";
import type { DashboardWidget, WidgetInput, WidgetKind } from "@/api/dashboards";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { kanbanApi } from "@/api/kanban";
import { reportsApi } from "@/api/reports";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";

import { FAMILY_LABELS, KINDS, KIND_FAMILIES, kindsOf } from "./kinds";
import { WidgetBody } from "./WidgetBody";

const { Text, Paragraph } = Typography;

export function WidgetModal({
  open,
  widget,
  datasets,
  kinds,
  saving,
  period,
  resources,
  onClose,
  onSave,
}: {
  open: boolean;
  widget: DashboardWidget | null;
  datasets: { key: string; label: string }[];
  kinds: WidgetKind[];
  saving: boolean;
  /** The dashboard's period, so the preview is drawn over what it will be. */
  period: string;
  resources: ExplorerResource[];
  onClose: () => void;
  onSave: (input: WidgetInput) => void;
}) {
  const [form] = Form.useForm();
  const [kind, setKind] = useState<WidgetKind>(widget?.kind ?? "KPI");
  /**
   * The form's values, mirrored so the preview can be built from them.
   *
   * `Form.useWatch` would need one call per field and would still miss the
   * ones a kind adds; keeping the whole object is simpler and is what the
   * preview needs anyway. It costs a render per keystroke, and the preview's
   * *query* key only changes when the question does — so typing a title
   * redraws and does not refetch.
   */
  const [values, setValues] = useState<Record<string, string | boolean | number>>({});
  // A widget's question is several choices — a dataset, a dimension, a
  // period — and closing the modal would take them all (§74).
  const { touch, requestClose } = useDiscardGuard({ close: onClose, what: "widget" });

  const catalogue = useQuery({
    queryKey: ["analysis-catalogue"],
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: 300_000,
  });

  // What the reader has already made. Fetched only when a kind that references
  // one is chosen, so opening the drawer for a KPI costs nothing.
  const shape = KINDS[kind];
  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: ({ signal }) => reportsApi.list(signal),
    enabled: open && shape.needs === "report",
    staleTime: 60_000,
  });
  const searches = useQuery({
    queryKey: ["saved-searches", "all"],
    queryFn: ({ signal }) => explorerApi.saved(undefined, signal),
    enabled: open && shape.needs === "search",
    staleTime: 60_000,
  });
  // Only a `TASKS` widget pointed at a board needs the board list, so it is
  // asked for only then — a drawer opened on a KPI should cost nothing.
  const boards = useQuery({
    queryKey: ["kanban-boards", {}],
    queryFn: ({ signal }) => kanbanApi.boards({}, signal),
    enabled: open && kind === "TASKS",
    staleTime: 300_000,
  });

  const initial = {
    kind: widget?.kind ?? "KPI",
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

  const dataset = catalogue.data?.datasets.find(
    (item) => item.key === (form.getFieldValue("entity") ?? initial.entity),
  );

  /**
   * The widget as it would be, for the preview.
   *
   * Built from the *same* `configFor` the save uses, so what is drawn is not
   * an approximation of what will be added — it is what will be added, minus
   * an id. Geometry is a plausible size for the kind rather than the one it
   * will get, because the preview pane is not the grid and pretending
   * otherwise would make a full-width card look wrong here and right there.
   */
  const draft: DashboardWidget = {
    id: widget?.id ?? "preview",
    kind,
    title: String(values["title"] ?? initial.title) || KINDS[kind].label,
    subtitle: (values["subtitle"] as string) || null,
    x: 0,
    y: 0,
    width: 6,
    height: 2,
    position: 0,
    config: configFor(kind, { ...initial, ...values }) ?? {},
  };

  return (
    <Modal
      open={open}
      onCancel={requestClose}
      width={940}
      destroyOnHidden
      title={widget ? `Configure ${widget.title}` : "Add a widget"}
      className="nu-widget-modal"
      okText={widget ? "Save" : "Add to the dashboard"}
      confirmLoading={saving}
      onOk={() => void form.submit()}
      okButtonProps={{ "data-testid": "save-widget" }}
    >
      <div className="nu-widget-modal-panes">
      <div className="nu-widget-modal-form">
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onValuesChange={(changed: { kind?: WidgetKind }, all: Record<string, string | boolean | number>) => {
          touch();
          setValues(all);
          if (changed.kind) setKind(changed.kind);
        }}
        onFinish={(values: Record<string, string | boolean | number>) => {
          const chosen = (values["kind"] ?? "KPI") as WidgetKind;
          onSave({
            kind: chosen,
            title: String(values["title"] ?? ""),
            subtitle: (values["subtitle"] as string) || null,
            // The size a new widget gets comes from the server, which is the
            // one place that knows a KPI wants three columns. An edited one
            // keeps where the reader put it.
            ...(widget ? {} : { x: 0 }),
            config: configFor(chosen, values),
          });
        }}
      >
        {/* Browsed, not selected from a list. Twenty-six kinds is more than a
            select is good for, and a card can carry the *question the kind
            answers* — which is what somebody who does not already know what a
            heatmap is for needs in order to choose one. */}
        <Form.Item name="kind" label="What kind" className="nu-widget-modal-kinds">
          <KindGallery available={kinds} />
        </Form.Item>
        <Form.Item
          name="title"
          label="Title"
          rules={[{ required: true, message: "Say what this widget answers" }]}
        >
          <Input placeholder="Open tickets by severity" />
        </Form.Item>
        <Form.Item name="subtitle" label="Note">
          <Input placeholder="Optional — scope, caveat, period" />
        </Form.Item>

        {shape.needs === "report" && (
          <Form.Item
            name="report_id"
            label="Which report"
            rules={[{ required: true, message: "Pick a report to draw" }]}
            extra="Drawn the way the report itself says it should be. Editing the report takes its widgets with it."
          >
            <Select
              aria-label="Report"
              loading={reports.isLoading}
              options={(reports.data?.items ?? []).map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.visualization}`,
              }))}
              notFoundContent={
                reports.isLoading ? "Loading…" : "You have not saved a report yet"
              }
            />
          </Form.Item>
        )}

        {shape.needs === "search" && (
          <Form.Item
            name="search_id"
            label="Which search"
            rules={[{ required: true, message: "Pick a saved search to answer" }]}
            extra="Answered through the explorer query, under the same permissions."
          >
            <Select
              aria-label="Saved search"
              loading={searches.isLoading}
              options={(searches.data?.items ?? []).map((item) => ({
                value: item.id,
                label: `${item.name} · ${item.resource_type}`,
              }))}
              notFoundContent={
                searches.isLoading ? "Loading…" : "You have not saved a search yet"
              }
            />
          </Form.Item>
        )}

        {shape.needs === "dataset" && (
          <>
            <Form.Item name="entity" label="Dataset">
              <Select
                aria-label="Dataset"
                options={datasets.map((item) => ({ value: item.key, label: item.label }))}
              />
            </Form.Item>
            {/* A `CHART` names its own picture — that is the whole of what
                separates it from the five fixed chart kinds. */}
            {kind === "CHART" && (
              <Form.Item
                name="chart"
                label="Draw it as"
                extra="Every shape the chart builder can draw, on a dashboard."
              >
                <Select
                  aria-label="Chart kind"
                  showSearch
                  optionFilterProp="label"
                  options={WIDGET_CHARTS.map((item) => ({ value: item.key, label: item.label }))}
                />
              </Form.Item>
            )}
            {(kind === "KPI" || kind === "GAUGE") && (
              <Form.Item
                name="metric"
                label="Which number"
                extra="Leave empty to take the dataset's first declared metric."
              >
                <Select
                  aria-label="Metric"
                  allowClear
                  options={(dataset?.measures ?? []).map((item) => ({
                    value: item.name,
                    label: item.label,
                  }))}
                />
              </Form.Item>
            )}
            {kind !== "KPI" &&
              kind !== "GAUGE" &&
              kind !== "LIST" &&
              kind !== "TABLE" &&
              kind !== "MAP" &&
              kind !== "ANALYTICS" && (
                <Form.Item
                  name="dimension"
                  label="Group by"
                  extra="Leave empty to use the dataset's own default."
                >
                  <Select
                    aria-label="Group by"
                    allowClear
                    options={(dataset?.dimensions ?? []).map((item) => ({
                      value: item.name,
                      label: item.label,
                    }))}
                  />
                </Form.Item>
              )}
            {(kind === "HEATMAP" || kind === "CHART") && (
              <Form.Item
                name="stack"
                label="And by"
                extra="A second grouping — a stack, or a heatmap's columns."
              >
                <Select
                  aria-label="And by"
                  allowClear
                  options={(dataset?.dimensions ?? []).map((item) => ({
                    value: item.name,
                    label: item.label,
                  }))}
                />
              </Form.Item>
            )}
            <Form.Item
              name="period"
              label="Period"
              extra="Leave empty to follow the dashboard's own period."
            >
              <Select
                aria-label="Period"
                allowClear
                options={[
                  { value: "all_time", label: "All time" },
                  ...(catalogue.data?.periods ?? []).map((item) => ({
                    value: item.key,
                    label: item.label,
                  })),
                ]}
              />
            </Form.Item>
          </>
        )}

        {/* The module options. Each one narrows the page the widget mirrors;
            none of them is required, because a module widget with nothing said
            shows that module's own default view. */}
        {kind === "TASKS" && (
          <>
            <Form.Item
              name="board_id"
              label="A board, or the whole dataset"
              extra="A board shows the lanes that team agreed. Leave empty for every task, by status."
            >
              <Select
                aria-label="Board"
                allowClear
                loading={boards.isLoading}
                options={(boards.data?.items ?? []).map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
                notFoundContent={boards.isLoading ? "Loading…" : "No boards yet"}
              />
            </Form.Item>
            <Form.Item name="status" label="One lane only" extra="Leave empty to show them all.">
              <Input placeholder="IN_PROGRESS" />
            </Form.Item>
          </>
        )}

        {kind === "MAIL" && (
          <>
            <Form.Item name="folder" label="Folder">
              <Select
                aria-label="Folder"
                options={["INBOX", "SENT", "DRAFTS", "ARCHIVE", "SPAM", "TRASH"].map((item) => ({
                  value: item,
                  label: item.charAt(0) + item.slice(1).toLowerCase(),
                }))}
              />
            </Form.Item>
            <Form.Item name="unread_only" label="Unread only" valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
        )}

        {kind === "NOTIFICATIONS" && (
          <>
            <Form.Item name="category" label="One category only">
              <Input placeholder="Leave empty for all" />
            </Form.Item>
            <Form.Item name="unread_only" label="Unread only" valuePropName="checked">
              <Switch />
            </Form.Item>
          </>
        )}

        {kind === "ANNOUNCEMENTS" && (
          <Form.Item name="category" label="One category only">
            <Input placeholder="Leave empty for all" />
          </Form.Item>
        )}

        {kind === "PROJECTS" && (
          <Form.Item name="status" label="One state only" extra="Leave empty to show them all.">
            <Input placeholder="IN_PROGRESS" />
          </Form.Item>
        )}

        {kind === "CALENDAR" && (
          <Form.Item
            name="days"
            label="How far ahead"
            extra="An agenda, not a month — a month grid at card size has nothing readable in it."
          >
            <Select
              aria-label="How far ahead"
              options={[
                { value: 1, label: "Today" },
                { value: 3, label: "The next three days" },
                { value: 7, label: "The next week" },
                { value: 14, label: "The next fortnight" },
                { value: 30, label: "The next month" },
              ]}
            />
          </Form.Item>
        )}

        {kind === "FAVORITES" && (
          <Form.Item
            name="view"
            label="Which list"
            extra="A bookmark is a decision you made; a recent is a by-product. They are not the same list."
          >
            <Segmented
              options={[
                { value: "bookmarks", label: "Favourites" },
                { value: "recents", label: "Recently visited" },
              ]}
            />
          </Form.Item>
        )}

        {(kind === "EXPLORER" || kind === "RELATIONSHIPS") && (
          <Form.Item
            name="entity"
            label="One dataset only"
            extra="Leave empty to cover every dataset you can read."
          >
            <Select
              aria-label="Dataset"
              allowClear
              options={datasets.map((item) => ({ value: item.key, label: item.label }))}
            />
          </Form.Item>
        )}
      </Form>
      </div>

      {/* The widget itself, drawn from live data. Not a picture of one: this
          is the same `WidgetBody` the grid renders, so a dataset that answers
          nothing says so here rather than after the card has been added and
          found again. */}
      <aside className="nu-widget-modal-preview" aria-label="Preview">
        <Text type="secondary" className="nu-widget-modal-caption">
          Preview · live data
        </Text>
        <div className="nu-widget-modal-frame">
          <div className="nu-widget-modal-frame-head">
            <span>{draft.title}</span>
          </div>
          <div className="nu-widget-modal-frame-body">
            {KINDS[kind].needs !== "nothing" && !hasSubject(draft) ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`Pick ${KINDS[kind].needs === "dataset" ? "a dataset" : `a saved ${KINDS[kind].needs}`} to see it`}
              />
            ) : (
              <WidgetBody
                widget={draft}
                period={period}
                catalogue={catalogue.data}
                resources={resources}
              />
            )}
          </div>
        </div>
        <Paragraph type="secondary" className="nu-widget-modal-question">
          {KINDS[kind].question}
          {KINDS[kind].page ? ` It mirrors ${KINDS[kind].page}.` : ""}
        </Paragraph>
      </aside>
      </div>
    </Modal>
  );
}

/**
 * Whether a draft yet names the thing it is about.
 *
 * The same distinction `WidgetBody` draws between "unfinished" and "broken",
 * applied one step earlier: a kind with no subject is a preview that has
 * nothing to draw, and saying so beats rendering an error for a widget nobody
 * has finished describing (§34).
 */
function hasSubject(draft: DashboardWidget): boolean {
  if (draft.kind === "REPORT") return Boolean(draft.config.report_id);
  if (draft.kind === "SEARCH") return Boolean(draft.config.search_id);
  return Boolean(draft.config.entity);
}

/**
 * The kinds, on shelves, as a form control.
 *
 * A `Form.Item` child rather than state of its own: AntD passes `value` and
 * `onChange`, so the gallery is the kind field — one source for what has been
 * chosen, and no second copy to keep in step with the form.
 */
function KindGallery({
  available,
  value,
  onChange,
}: {
  available: WidgetKind[];
  value?: WidgetKind;
  onChange?: (kind: WidgetKind) => void;
}) {
  return (
    <div className="nu-kindpick" data-testid="widget-kind-gallery">
      {KIND_FAMILIES.map((family) => {
        const shelf = kindsOf(family, available);
        if (shelf.length === 0) return null;
        return (
          <section key={family}>
            <h4 className="nu-kindpick-shelf">
              {FAMILY_LABELS[family].label}
              <span>{FAMILY_LABELS[family].hint}</span>
            </h4>
            <div className="nu-kindpick-row">
              {shelf.map((item) => {
                const spec = KINDS[item];
                const chosen = value === item;
                return (
                  <button
                    key={item}
                    type="button"
                    className={`nu-kindpick-card${chosen ? " is-chosen" : ""}`}
                    aria-pressed={chosen}
                    title={spec.question}
                    data-testid={`kind-${item}`}
                    onClick={() => onChange?.(item)}
                  >
                    <span className="nu-kindpick-icon" style={{ color: spec.colour }}>
                      {spec.icon}
                    </span>
                    <span className="nu-kindpick-label">{spec.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** Every picture a `CHART` widget may name — the chart builder's own list. */
const WIDGET_CHARTS: { key: string; label: string }[] = [
  { key: "bar", label: "Bars" },
  { key: "hbar", label: "Bars, sideways" },
  { key: "line", label: "Line" },
  { key: "area", label: "Area" },
  { key: "pie", label: "Share" },
  { key: "stacked-bar", label: "Stacked bars" },
  { key: "stacked-area", label: "Stacked area" },
  { key: "multi-line", label: "Several lines" },
  { key: "treemap", label: "Treemap" },
  { key: "scatter", label: "Scatter" },
  { key: "radar", label: "Radar" },
  { key: "funnel", label: "Funnel" },
  { key: "heatmap", label: "Heatmap" },
];

/**
 * The config a form's values make, for the kind that was chosen.
 *
 * Keyed on the kind rather than sending everything, because the server refuses
 * a dataset on a feed and a dataset on a reference — both would be a second
 * opinion about where the widget's data comes from. Anything a kind does not
 * read is left out here rather than dropped there, so what is stored is what
 * the form actually asked.
 */
function configFor(
  kind: WidgetKind,
  values: Record<string, string | boolean | number>,
): WidgetInput["config"] {
  const text = (key: string) => {
    const value = values[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const flag = (key: string) => (values[key] ? true : undefined);
  const only = <T,>(entries: Record<string, T | undefined>) =>
    Object.fromEntries(Object.entries(entries).filter(([, value]) => value !== undefined));

  switch (kind) {
    case "REPORT":
      return { report_id: String(values["report_id"] ?? "") };
    case "SEARCH":
      return { search_id: String(values["search_id"] ?? "") };
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

