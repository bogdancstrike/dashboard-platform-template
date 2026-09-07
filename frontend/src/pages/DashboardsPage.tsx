/**
 * `/dashboards` — the reader's own dashboards, and the ones shared with them
 * (§45, §67).
 *
 * `/dashboard` is *the* dashboard: one fixed layout the platform designed,
 * answering the questions a template should demonstrate. This is the other
 * thing entirely — a layout somebody composed for the job they actually do,
 * saved, shared, and openable as their home page.
 *
 * Three decisions worth stating.
 *
 * **A widget names a question; it does not copy one.** The layout is stored
 * here and every number comes from the endpoint that already owns it — see
 * `components/dashboards/WidgetBody.tsx`. Nothing about a dashboard aggregates
 * anything, which is why a dashboard and the page it was built from cannot
 * disagree.
 *
 * **Editing is a mode, not a separate page.** A builder on its own screen is a
 * builder whose result you cannot see; the reading view *is* the editing view,
 * with the controls turned on. So "add a widget" lands on the grid it will
 * live on, and a resize is judged against the widgets beside it.
 *
 * **One drag saves the whole layout.** Moving a widget reflows the ones around
 * it, and one request per card lets a reader reload mid-flight and find a
 * layout that never existed (§73).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Segmented,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ColumnHeightOutlined,
  PlusOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { analysisApi } from "@/api/analysis";
import {
  dashboardsApi,
  type DashboardScope,
  type DashboardWidget,
  type Placement,
  type SavedDashboard,
  type WidgetInput,
  type WidgetKind,
} from "@/api/dashboards";
import { explorerApi } from "@/api/explorer";
import { reportsApi } from "@/api/reports";
import { PageHeader } from "@/components/PageHeader";
import { MemberPicker } from "@/components/PeoplePicker";
import { WidgetBody } from "@/components/dashboards/WidgetBody";
import { WidgetCard, type WidgetMoves } from "@/components/dashboards/WidgetCard";
import { WidgetGrid, compacted } from "@/components/dashboards/WidgetGrid";
import { usePageCommands } from "@/commands/CommandContext";
import { asText } from "@/lib/text";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

/**
 * What each kind is called, how big it wants to be when first added, and what
 * it needs naming.
 *
 * `feed` is a platform-wide feed and names no dataset. `references` names
 * something the reader already saved — a report from the chart builder, a
 * question from the explorer — which is what lets a saved chart become a
 * widget without being described again.
 *
 * Keyed on the whole `WidgetKind` union, so a kind the server offers is a kind
 * this page can describe: adding one to the server without adding it here
 * fails to compile.
 */
const WIDGETS: Record<
  WidgetKind,
  { label: string; width: number; height: number; feed?: true; references?: "report" | "search" }
> = {
  KPI: { label: "Headline number", width: 3, height: 1 },
  GAUGE: { label: "Gauge", width: 3, height: 2 },
  LINE_CHART: { label: "Line over time", width: 6, height: 2 },
  AREA_CHART: { label: "Area over time", width: 6, height: 2 },
  BAR_CHART: { label: "Bar comparison", width: 6, height: 2 },
  PIE_CHART: { label: "Share of the whole", width: 4, height: 2 },
  HEATMAP: { label: "Two-dimension heatmap", width: 6, height: 2 },
  LIST: { label: "Newest records", width: 4, height: 2 },
  TABLE: { label: "Records as a table", width: 6, height: 2 },
  ALERTS: { label: "What needs attention", width: 4, height: 2, feed: true },
  ACTIVITY: { label: "Recent activity", width: 4, height: 2, feed: true },
  REPORT: { label: "A saved report", width: 6, height: 2, references: "report" },
  SEARCH: { label: "A saved search", width: 4, height: 2, references: "search" },
};

export default function DashboardsPage() {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [widgetForm, setWidgetForm] = useState<DashboardWidget | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const listing = useQuery({
    queryKey: ["dashboards"],
    queryFn: ({ signal }) => dashboardsApi.list(signal),
  });

  const items = listing.data?.items ?? [];
  // The home dashboard first, then whatever the reader last opened — which is
  // in the URL, so a dashboard can be linked to (§69).
  const openId = params.get("dashboard") ?? items.find((item) => item.is_home)?.id ?? items[0]?.id ?? "";

  const dashboard = useQuery({
    queryKey: ["dashboard", openId],
    queryFn: ({ signal }) => dashboardsApi.get(openId, signal),
    enabled: Boolean(openId),
  });

  // What a widget may group by and measure, and which datasets exist. Read
  // once for the whole grid rather than once per widget.
  const catalogue = useQuery({
    queryKey: ["analysis-catalogue"],
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: 300_000,
  });
  const resources = useQuery({
    queryKey: ["explorer-catalogue"],
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: 300_000,
  });

  const open = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("dashboard", id);
        return next;
      },
      { replace: true },
    );

  /** Every write refreshes the layout it changed, and the list beside it. */
  const settled = (saved: SavedDashboard) => {
    queryClient.setQueryData(["dashboard", saved.id], saved);
    void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
  };

  const failed = (error: unknown) =>
    message.error(error instanceof ApiError ? error.message : "That change was not saved.");

  const createBoard = useMutation({
    mutationFn: (name: string) => dashboardsApi.create({ name }),
    onSuccess: (saved) => {
      settled(saved);
      open(saved.id);
      setEditing(true);
      message.success(`${saved.name} created`);
    },
    onError: failed,
  });

  const saveBoard = useMutation({
    mutationFn: (input: Parameters<typeof dashboardsApi.update>[1]) =>
      dashboardsApi.update(openId, input),
    onSuccess: (saved) => {
      settled(saved);
      setSettingsOpen(false);
    },
    onError: failed,
  });

  const removeBoard = useMutation({
    mutationFn: () => dashboardsApi.remove(openId),
    onSuccess: (gone) => {
      message.success(`${gone.name} deleted`);
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete("dashboard");
          return next;
        },
        { replace: true },
      );
      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
    },
    onError: failed,
  });

  const saveWidget = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: WidgetInput }) =>
      id
        ? dashboardsApi.updateWidget(openId, id, input)
        : dashboardsApi.addWidget(openId, input),
    onSuccess: (saved) => {
      settled(saved);
      setWidgetForm(null);
    },
    onError: failed,
  });

  const dropWidget = useMutation({
    mutationFn: (widgetId: string) => dashboardsApi.removeWidget(openId, widgetId),
    onSuccess: settled,
    onError: failed,
  });

  const arrange = useMutation({
    mutationFn: (placements: Placement[]) => dashboardsApi.arrange(openId, placements),
    onSuccess: settled,
    onError: failed,
  });

  const board = dashboard.data;
  const columns = board?.columns ?? listing.data?.columns ?? 12;
  const widgets = board?.widgets ?? [];

  /** The layout with one widget changed, sent whole (§73). */
  const rewrite = (changed: DashboardWidget) =>
    arrange.mutate(
      widgets
        .map((widget) => (widget.id === changed.id ? changed : widget))
        .map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    );

  // The keyboard half of the same moves the grid does with a pointer. Both
  // write the whole layout through one endpoint, so neither is a second
  // answer to "where is this widget" (§54).
  const moves: WidgetMoves = {
    nudge: (widget, dx, dy) =>
      rewrite({
        ...widget,
        x: Math.max(0, Math.min(columns - widget.width, widget.x + dx)),
        y: Math.max(0, widget.y + dy),
      }),
    resize: (widget, dWidth, dHeight) => {
      const width = Math.max(1, Math.min(columns, widget.width + dWidth));
      rewrite({
        ...widget,
        width,
        // Kept inside the grid here as well as on the server: a control that
        // produces a refusal every time it is pressed at the right edge is a
        // control nobody presses twice.
        x: Math.min(widget.x, columns - width),
        height: Math.max(1, Math.min(8, widget.height + dHeight)),
      });
    },
    edit: (widget) => setWidgetForm(widget),
    remove: (widget) => {
      // A block body, not an implicit return: `modal.confirm` hands back a
      // handle, and returning it from a `void` callback is a promise nobody
      // is waiting on.
      modal.confirm({
        title: `Remove ${widget.title}?`,
        content: "It comes off this dashboard. The data behind it is untouched.",
        okText: "Remove",
        okButtonProps: { danger: true },
        onOk: async () => {
          await dropWidget.mutateAsync(widget.id);
        },
      });
    },
  };

  usePageCommands("dashboards", [
    {
      id: "dashboards.new",
      label: "Create a dashboard",
      keywords: "add build layout",
      run: () => createBoard.mutate("New dashboard"),
    },
    {
      id: "dashboards.edit",
      label: "Rearrange this dashboard",
      keywords: "edit widgets move",
      run: () => setEditing(true),
    },
    {
      id: "dashboards.home",
      label: "Make this my home dashboard",
      keywords: "default landing",
      run: () => saveBoard.mutate({ is_home: true }),
    },
  ]);

  if (listing.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (listing.isError) {
    const error = listing.error;
    const api = error instanceof ApiError ? error : null;
    return (
      <>
        <PageHeader title="My dashboards" />
        <Alert
          type={api?.isForbidden ? "warning" : "error"}
          showIcon
          message={api?.message ?? "Your dashboards could not be loaded"}
          description={
            api ? (
              <Space direction="vertical" size={4}>
                {api.missingPermissions.length > 0 && (
                  <Text type="secondary">Missing: {api.missingPermissions.join(", ")}</Text>
                )}
                <Text code copyable={{ text: api.correlationId }}>
                  {api.correlationId}
                </Text>
              </Space>
            ) : undefined
          }
        />
      </>
    );
  }

  const canCreate = listing.data?.can_create ?? false;

  return (
    <>
      <PageHeader
        title="My dashboards"
        subtitle="Layouts you composed, and the ones colleagues shared with you. Every widget asks the platform the same question the page behind it would."
        tag={board?.is_home ? <Tag color="blue">Home</Tag> : undefined}
        actions={
          <>
            {board?.can_edit && (
              <Button
                type={editing ? "primary" : "default"}
                icon={<SettingOutlined />}
                onClick={() => setEditing(!editing)}
                data-testid="toggle-edit"
              >
                {editing ? "Done" : "Rearrange"}
              </Button>
            )}
            {editing && board?.can_edit && (
              <>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => setWidgetForm("new")}
                  data-testid="add-widget"
                >
                  Add a widget
                </Button>
                {/* The same rule the grid applies during a drag, on demand: a
                    dashboard edited for a while accumulates gaps, and closing
                    them is something a person wants to press. */}
                <Button
                  icon={<ColumnHeightOutlined />}
                  loading={arrange.isPending}
                  disabled={widgets.length === 0}
                  onClick={() => arrange.mutate(compacted(widgets, columns))}
                  data-testid="tidy-up"
                >
                  Tidy up
                </Button>
              </>
            )}
            <Tooltip title={canCreate ? "" : "Your role does not include dashboards.manage"}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canCreate}
                loading={createBoard.isPending}
                onClick={() => createBoard.mutate("New dashboard")}
                data-testid="new-dashboard"
              >
                New dashboard
              </Button>
            </Tooltip>
          </>
        }
      />

      {items.length === 0 ? (
        <Card size="small">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="Nothing saved yet. Create one and it will appear here."
          />
        </Card>
      ) : !openId ? (
        <Card size="small">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Pick a dashboard" />
        </Card>
      ) : dashboard.isLoading ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : dashboard.isError ? (
        <Alert
          type="error"
          showIcon
          message={
            dashboard.error instanceof ApiError
              ? dashboard.error.message
              : "That dashboard could not be opened"
          }
        />
      ) : (
        <>
          {/* One strip: which dashboard, whose it is, and what may be done to
              it. A column of dashboard names beside the grid spent a sixth of
              the page on a list of four things and left the rest of that
              column empty. */}
          <Card size="small" data-testid="dashboard-header">
            <Space size={12} wrap>
              <Select
                aria-label="Dashboard"
                style={{ minWidth: 220 }}
                value={openId}
                onChange={open}
                data-testid="dashboard-picker"
                options={items.map((item) => ({
                  value: item.id,
                  label: item.is_home ? `${item.name} · home` : item.name,
                }))}
              />
              {board?.description && <Text type="secondary">{board.description}</Text>}
              <Text type="secondary">
                {board?.owner.name} · {board?.scope.toLowerCase()} ·{" "}
                {board?.widget_count} {board?.widget_count === 1 ? "widget" : "widgets"} ·{" "}
                {board?.updated_at ? relativeTime(board.updated_at) : "—"}
              </Text>
              <Tooltip title={board?.can_edit ? "" : "Only the owner may change a dashboard"}>
                <Button
                  size="small"
                  disabled={!board?.can_edit}
                  onClick={() => setSettingsOpen(true)}
                >
                  Settings
                </Button>
              </Tooltip>
            </Space>
          </Card>

          {widgets.length === 0 ? (
            <Card size="small" className="nu-block">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No widgets yet">
                {board?.can_edit && (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setEditing(true);
                      setWidgetForm("new");
                    }}
                  >
                    Add the first one
                  </Button>
                )}
              </Empty>
            </Card>
          ) : (
            <div className="nu-block" data-testid="dashboard-grid">
              <WidgetGrid
                widgets={widgets}
                columns={columns}
                editable={editing && Boolean(board?.can_edit)}
                onCommit={(placements) => arrange.mutate(placements)}
              >
                {(widget) => (
                  <WidgetCard
                    widget={widget}
                    editable={editing && Boolean(board?.can_edit)}
                    moves={moves}
                  >
                    <WidgetBody
                      widget={widget}
                      period={asText(board?.filters["period"]) || "last_30_days"}
                      catalogue={catalogue.data}
                      resources={resources.data?.items ?? []}
                    />
                  </WidgetCard>
                )}
              </WidgetGrid>
            </div>
          )}
        </>
      )}

      <WidgetDrawer
        open={widgetForm !== null}
        widget={widgetForm === "new" ? null : widgetForm}
        datasets={listing.data?.datasets ?? []}
        kinds={listing.data?.widget_kinds ?? []}
        saving={saveWidget.isPending}
        onClose={() => setWidgetForm(null)}
        onSave={(input) =>
          saveWidget.mutate({
            id: widgetForm === "new" || widgetForm === null ? null : widgetForm.id,
            input,
          })
        }
      />

      <SettingsDrawer
        open={settingsOpen}
        dashboard={board}
        saving={saveBoard.isPending}
        canShare={listing.data?.can_share ?? false}
        onClose={() => setSettingsOpen(false)}
        onSave={(input) => saveBoard.mutate(input)}
        onDelete={() =>
          modal.confirm({
            title: `Delete ${board?.name}?`,
            content: "The layout goes. Nothing it pointed at is affected.",
            okText: "Delete",
            okButtonProps: { danger: true },
            onOk: async () => {
              await removeBoard.mutateAsync();
            },
          })
        }
      />
    </>
  );
}

/**
 * What a widget shows, as a form.
 *
 * The kind decides which controls appear, because a heatmap needs a second
 * grouping and an alert strip needs nothing at all. Offering every field for
 * every kind would be a form that mostly does not apply — and a config the
 * server would then have to ignore.
 */
function WidgetDrawer({
  open,
  widget,
  datasets,
  kinds,
  saving,
  onClose,
  onSave,
}: {
  open: boolean;
  widget: DashboardWidget | null;
  datasets: { key: string; label: string }[];
  kinds: WidgetKind[];
  saving: boolean;
  onClose: () => void;
  onSave: (input: WidgetInput) => void;
}) {
  const [form] = Form.useForm();
  const [kind, setKind] = useState<WidgetKind>(widget?.kind ?? "KPI");

  const catalogue = useQuery({
    queryKey: ["analysis-catalogue"],
    queryFn: ({ signal }) => analysisApi.catalogue(signal),
    staleTime: 300_000,
  });

  // What the reader has already made. Fetched only when a kind that references
  // one is chosen, so opening the drawer for a KPI costs nothing.
  const shape = WIDGETS[kind];
  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: ({ signal }) => reportsApi.list(signal),
    enabled: open && shape.references === "report",
    staleTime: 60_000,
  });
  const searches = useQuery({
    queryKey: ["saved-searches", "all"],
    queryFn: ({ signal }) => explorerApi.saved(undefined, signal),
    enabled: open && shape.references === "search",
    staleTime: 60_000,
  });

  const initial = {
    kind: widget?.kind ?? "KPI",
    title: widget?.title ?? "",
    subtitle: widget?.subtitle ?? "",
    entity: widget?.config.entity ?? datasets[0]?.key ?? "",
    dimension: widget?.config.dimension ?? "",
    stack: widget?.config.stack ?? "",
    period: widget?.config.period ?? "",
    report_id: widget?.config.report_id ?? "",
    search_id: widget?.config.search_id ?? "",
  };

  const dataset = catalogue.data?.datasets.find(
    (item) => item.key === (form.getFieldValue("entity") ?? initial.entity),
  );

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={420}
      destroyOnClose
      title={widget ? `Configure ${widget.title}` : "Add a widget"}
      extra={
        <Button type="primary" loading={saving} onClick={() => void form.submit()}
                data-testid="save-widget">
          {widget ? "Save" : "Add"}
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={initial}
        onValuesChange={(changed: { kind?: WidgetKind }) => {
          if (changed.kind) setKind(changed.kind);
        }}
        onFinish={(values: Record<string, string>) => {
          const chosen = (values["kind"] ?? "KPI") as WidgetKind;
          const wanted = WIDGETS[chosen];
          onSave({
            kind: chosen,
            title: values["title"] ?? "",
            subtitle: values["subtitle"] || null,
            // A newly added widget takes the size its kind wants; an edited
            // one keeps where the reader put it.
            ...(widget ? {} : { width: wanted.width, height: wanted.height, x: 0 }),
            // The kind decides what the config may hold, because the server
            // refuses a dataset on a feed and a dataset on a reference — both
            // would be a second opinion about where the data comes from.
            config: wanted.feed
              ? {}
              : wanted.references === "report"
                ? { report_id: values["report_id"] ?? "" }
                : wanted.references === "search"
                  ? { search_id: values["search_id"] ?? "" }
                  : {
                      entity: values["entity"] ?? "",
                      ...(values["dimension"] ? { dimension: values["dimension"] } : {}),
                      ...(values["stack"] ? { stack: values["stack"] } : {}),
                      ...(values["period"] ? { period: values["period"] } : {}),
                    },
          });
        }}
      >
        <Form.Item name="kind" label="What kind">
          <Select
            aria-label="Widget kind"
            options={kinds.map((item) => ({
              value: item,
              label: WIDGETS[item].label,
            }))}
          />
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

        {shape.references === "report" && (
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

        {shape.references === "search" && (
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

        {!shape.feed && !shape.references && (
          <>
            <Form.Item name="entity" label="Dataset">
              <Select
                aria-label="Dataset"
                options={datasets.map((item) => ({ value: item.key, label: item.label }))}
              />
            </Form.Item>
            {kind !== "KPI" && kind !== "GAUGE" && kind !== "LIST" && kind !== "TABLE" && (
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
            {kind === "HEATMAP" && (
              <Form.Item name="stack" label="And by" extra="A heatmap reads two dimensions.">
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
      </Form>
    </Drawer>
  );
}

/** The dashboard itself: its name, who sees it, and whether it is home. */
function SettingsDrawer({
  open,
  dashboard,
  saving,
  canShare,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  dashboard: SavedDashboard | undefined;
  saving: boolean;
  canShare: boolean;
  onClose: () => void;
  onSave: (input: Parameters<typeof dashboardsApi.update>[1]) => void;
  onDelete: () => void;
}) {
  const [form] = Form.useForm();
  if (!dashboard) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={420}
      destroyOnClose
      title={`Settings — ${dashboard.name}`}
      extra={
        <Button type="primary" loading={saving} onClick={() => void form.submit()}
                data-testid="save-dashboard">
          Save
        </Button>
      }
      footer={
        <Button danger onClick={onDelete} data-testid="delete-dashboard">
          Delete this dashboard
        </Button>
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: dashboard.name,
          description: dashboard.description ?? "",
          scope: dashboard.scope,
          is_home: dashboard.is_home,
          period: asText(dashboard.filters["period"]) || "last_30_days",
          member_ids: dashboard.members.map((member) => member.id),
        }}
        onFinish={(values: {
          name: string;
          description?: string;
          scope: DashboardScope;
          is_home?: boolean;
          period?: string;
          member_ids?: string[];
        }) =>
          onSave({
            name: values.name,
            description: values.description || null,
            scope: values.scope,
            is_home: values.is_home ?? false,
            filters: { period: values.period ?? "last_30_days" },
            member_ids: values.member_ids ?? [],
          })
        }
      >
        <Form.Item name="name" label="Name" rules={[{ required: true, message: "Give it a name" }]}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label="What it is for">
          <Input.TextArea rows={2} />
        </Form.Item>
        <Form.Item
          name="period"
          label="Period"
          extra="Every widget that names no period of its own follows this."
        >
          <Select
            aria-label="Dashboard period"
            options={[
              { value: "all_time", label: "All time" },
              { value: "last_7_days", label: "Last 7 days" },
              { value: "last_30_days", label: "Last 30 days" },
              { value: "last_90_days", label: "Last 90 days" },
              { value: "last_365_days", label: "Last 365 days" },
            ]}
          />
        </Form.Item>
        <Form.Item name="scope" label="Who can see it">
          <Segmented
            options={[
              { value: "PRIVATE", label: "Only me" },
              { value: "SHARED", label: "Named people", disabled: !canShare },
              { value: "PUBLIC", label: "Everyone", disabled: !canShare },
            ]}
          />
        </Form.Item>
        <Form.Item
          noStyle
          shouldUpdate={(before: { scope?: string }, after: { scope?: string }) =>
            before.scope !== after.scope
          }
        >
          {({ getFieldValue }) =>
            (getFieldValue("scope") as string) === "SHARED" ? (
              <Form.Item name="member_ids" label="Shared with">
                <MemberPicker placeholder="Search colleagues" />
              </Form.Item>
            ) : null
          }
        </Form.Item>
        <Form.Item
          name="is_home"
          label="My home dashboard"
          valuePropName="checked"
          extra="One at a time — choosing this one releases the last (§67)."
        >
          <Switch />
        </Form.Item>
      </Form>
    </Drawer>
  );
}
