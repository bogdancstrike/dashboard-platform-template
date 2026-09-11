/**
 * Choosing what a widget shows — with the widget drawn beside the form (§45).
 *
 * This was a 420-pixel drawer holding a form: pick "Heatmap · task · assignee
 * · last 30 days", press Add, and then find out what you made by hunting for
 * the card on the grid. Two problems, and they compound — somebody who does
 * not already know what a heatmap of a dataset looks like cannot choose one,
 * and every correction costs a round trip through a card they have to find
 * again.
 *
 * So it is a modal with two panes: the decision on the left, **the widget
 * itself on the right, drawn from live data**. Four decisions shape it.
 *
 * **The preview is the real card, not a picture of one.** It renders
 * `WidgetCard` around `WidgetBody` — the same two components the grid uses —
 * inside a box the height of the grid rows the widget will occupy. A preview
 * built out of different components is a preview that is wrong the first week
 * either changes, and "a table in a box" tells nobody what the card will look
 * like on the page.
 *
 * **The name comes first.** Title and note are the two fields somebody always
 * fills in, for every kind; the kind-specific controls appear underneath and
 * change as the kind does. A form whose first field moves depending on an
 * answer further down reads as a form that was assembled rather than designed.
 *
 * **The kinds are a dropdown, not a wall.** Twenty-six of them laid out as
 * cards was five shelves and four hundred pixels before the first real
 * question. Grouped in one select, with the icon and the *question the kind
 * answers* on each row, they cost one line and read better — the question is
 * what somebody choosing between "Bars" and "Share" actually needs.
 *
 * **The preview is debounced by React Query, not by a timer.** Every field
 * change re-renders it; the request key changes only when the *question* does,
 * so typing a title redraws and does not refetch.
 */

import { useQuery } from "@tanstack/react-query";
import { Form, Input, Modal, Segmented, Select, Switch, Typography } from "antd";
import { useState } from "react";

import { analysisApi } from "@/api/analysis";
import type { DashboardWidget, WidgetInput, WidgetKind } from "@/api/dashboards";
import { explorerApi, type ExplorerResource } from "@/api/explorer";
import { kanbanApi } from "@/api/kanban";
import { reportsApi } from "@/api/reports";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { EmptyState } from "@/components/EmptyState";

import { FAMILY_LABELS, KINDS, KIND_FAMILIES, kindsOf, type KindSpec } from "./kinds";
import { WidgetBody } from "./WidgetBody";
import { WidgetCard, type WidgetMoves } from "./WidgetCard";
import { PREVIEW_SIZES, ROW_HEIGHT } from "./WidgetGrid";

const { Text, Paragraph } = Typography;

/**
 * A card in a preview cannot be moved, so the moves are refused rather than
 * absent: `WidgetCard` takes them whether or not it is editable, and passing
 * handlers that quietly do nothing would be a control that looks live.
 */
const NO_MOVES: WidgetMoves = {
  nudge: () => {},
  resize: () => {},
  setSize: () => {},
  edit: () => {},
  remove: () => {},
};

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

  // The size the server will actually give it, mirrored so the preview is the
  // shape the card will be rather than a rectangle chosen to look good here.
  const size = PREVIEW_SIZES[kind];

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
        {/* The two fields every kind has, first — and in the order somebody
            fills them. What follows changes as the kind changes; a form whose
            first field moves depending on an answer further down reads as one
            that was assembled rather than designed. */}
        <Form.Item
          name="title"
          label="Title"
          rules={[{ required: true, message: "Say what this widget answers" }]}
        >
          <Input placeholder="Open tickets by severity" autoFocus />
        </Form.Item>
        <Form.Item name="subtitle" label="Note">
          <Input placeholder="Optional — scope, caveat, period" />
        </Form.Item>

        {/* One dropdown, grouped by family. Twenty-six kinds as cards was five
            shelves and four hundred pixels before the first real question;
            each row here still carries the *question the kind answers*, which
            is what somebody choosing between "Bars" and "Share" needs. */}
        <Form.Item name="kind" label="What kind" extra={KINDS[kind].question}>
          <Select
            aria-label="Widget kind"
            showSearch
            optionFilterProp="label"
            listHeight={340}
            popupMatchSelectWidth={false}
            data-testid="widget-kind"
            options={KIND_FAMILIES.map((family) => ({
              label: FAMILY_LABELS[family].label,
              options: kindsOf(family, kinds).map((item) => ({
                value: item,
                label: KINDS[item].label,
                spec: KINDS[item],
              })),
            })).filter((group) => group.options.length > 0)}
            optionRender={(option) => {
              // The option as it was declared, which is the only place the
              // spec is: AntD types `data` as the *group* shape here because
              // the list is grouped, and the runtime value is the leaf.
              const data = option.data as unknown as { value: WidgetKind; spec: KindSpec };
              const spec = data.spec;
              return (
                <span className="nu-kindrow" data-testid={`kind-${data.value}`}>
                  <span className="nu-kindrow-icon" style={{ color: spec.colour }}>
                    {spec.icon}
                  </span>
                  <span className="nu-kindrow-text">
                    <span className="nu-kindrow-label">{spec.label}</span>
                    <span className="nu-kindrow-question">{spec.question}</span>
                  </span>
                </span>
              );
            }}
          />
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

      {/* The card as it will appear on the grid — the same `WidgetCard` and
          the same `WidgetBody`, at the height of the rows it will occupy. A
          preview assembled from different components is one that is wrong the
          first week either changes, and a table in a plain box tells nobody
          what the thing will look like on the page. */}
      <aside className="nu-widget-modal-preview" aria-label="Preview">
        <Text type="secondary" className="nu-widget-modal-caption">
          How it will look
        </Text>
        <div
          className="nu-widget-modal-cell"
          // The grid's own row height, so a one-row KPI is visibly a strip and
          // a three-row calendar is visibly a panel. Guessing a height here is
          // how a preview ends up flattering every kind equally.
          style={{ height: size.h * ROW_HEIGHT + (size.h - 1) * 12 }}
        >
          <WidgetCard widget={draft} editable={false} columns={12} moves={NO_MOVES}>
            {KINDS[kind].needs !== "nothing" && !hasSubject(draft) ? (
              <EmptyState compact title={
                  <Text type="secondary">
                    {KINDS[kind].needs === "dataset"
                      ? "Pick a dataset to see it"
                      : `Pick a saved ${KINDS[kind].needs} to see it`}
                  </Text>
                } />
            ) : (
              <WidgetBody
                widget={draft}
                period={period}
                catalogue={catalogue.data}
                resources={resources}
              />
            )}
          </WidgetCard>
        </div>
        <Paragraph type="secondary" className="nu-widget-modal-question">
          Lands at the bottom of the dashboard, {size.w} columns by {size.h}{" "}
          {size.h === 1 ? "row" : "rows"} — drag its corner from there.
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

