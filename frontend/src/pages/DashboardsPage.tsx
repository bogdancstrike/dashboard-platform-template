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
 * **The landing state is a gallery, not a picker.** What a reader is choosing
 * between is not a *name* — it is a layout — so each card says what its
 * dashboard holds. A select in a header made every dashboard look identical
 * and gave the choice one line of the page.
 *
 * **Creating one is a wizard; editing one is a drawer.** The distinction is
 * not decoration: a wizard makes a decision that has parts — what to call it,
 * what it will hold, who sees it — and a drawer edits an object that already
 * exists. A single form asking all three at once gets a worse answer to each.
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
  TeamOutlined,
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
import { CreateDashboardWizard } from "@/components/dashboards/CreateDashboardWizard";
import { KINDS, KIND_ORDER } from "@/components/dashboards/kinds";
import { DashboardCard } from "@/components/dashboards/DashboardCard";
import { WidgetCard, type WidgetMoves } from "@/components/dashboards/WidgetCard";
import { WidgetGrid, compacted } from "@/components/dashboards/WidgetGrid";
import { usePageCommands } from "@/commands/CommandContext";
import { asText } from "@/lib/text";
import { relativeTime } from "@/lib/time";

const { Text } = Typography;

export default function DashboardsPage() {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [widgetForm, setWidgetForm] = useState<DashboardWidget | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const listing = useQuery({
    queryKey: ["dashboards"],
    queryFn: ({ signal }) => dashboardsApi.list(signal),
  });

  const items = listing.data?.items ?? [];
  // Only what the URL names. No dashboard is opened by default, because the
  // gallery *is* the landing state — and a page that silently opens one is a
  // page whose address does not describe what is on screen (§69).
  const openId = params.get("dashboard") ?? "";

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

  // Whether the reader has anything to point a `REPORT` or `SEARCH` widget at.
  // Asked once for the page rather than per card, and only to decide what the
  // picker may offer.
  const savedReports = useQuery({
    queryKey: ["reports"],
    queryFn: ({ signal }) => reportsApi.list(signal),
    staleTime: 300_000,
  });
  const savedSearches = useQuery({
    queryKey: ["saved-searches", "all"],
    queryFn: ({ signal }) => explorerApi.saved(undefined, signal),
    staleTime: 300_000,
  });

  const open = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (id) next.set("dashboard", id);
        else next.delete("dashboard");
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
      run: () => setWizardOpen(true),
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

  // The two kinds that draw something the reader already made. Offered and
  // refused with the reason rather than hidden, so somebody learns that a
  // saved chart can become a widget (§76).
  const unavailable: Partial<Record<WidgetKind, string>> = {
    ...(savedReports.data?.total === 0
      ? { REPORT: "You have not saved a report yet" }
      : {}),
    ...(savedSearches.data?.total === 0
      ? { SEARCH: "You have not saved a search yet" }
      : {}),
  };

  return (
    <>
      <PageHeader
        title={openId && board ? board.name : "My dashboards"}
        onBack={openId ? () => open("") : undefined}
        subtitle={
          openId && board
            ? [
                board.owner.name,
                board.scope.toLowerCase(),
                `${board.widget_count} ${board.widget_count === 1 ? "widget" : "widgets"}`,
                board.updated_at ? relativeTime(board.updated_at) : "",
              ]
                .filter(Boolean)
                .join(" · ")
            : "Layouts you composed, and the ones colleagues shared with you. Every widget asks the platform the same question the page behind it would."
        }
        tag={board?.is_home ? <Tag color="blue">Home</Tag> : undefined}
        actions={
          openId && board ? (
            <>
              {board.can_edit && (
                <Button
                  type={editing ? "primary" : "default"}
                  icon={<SettingOutlined />}
                  onClick={() => setEditing(!editing)}
                  data-testid="toggle-edit"
                >
                  {editing ? "Done" : "Rearrange"}
                </Button>
              )}
              {editing && board.can_edit && (
                <>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => setWidgetForm("new")}
                    data-testid="add-widget"
                  >
                    Add a widget
                  </Button>
                  {/* The same rule the grid applies during a drag, on demand:
                      a dashboard edited for a while accumulates gaps, and
                      closing them is something a person wants to press. */}
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
              <Tooltip title={board.can_edit ? "" : "Only the owner may change a dashboard"}>
                {/* Addressed by test id, not by name: the icon contributes
                    its own label, so the accessible name reads "team
                    Settings" — the same trap the export control documents. */}
                <Button
                  icon={<TeamOutlined />}
                  disabled={!board.can_edit}
                  onClick={() => setSettingsOpen(true)}
                  data-testid="board-settings"
                >
                  Settings
                </Button>
              </Tooltip>
            </>
          ) : (
            <Tooltip title={canCreate ? "" : "Your role does not include dashboards.manage"}>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!canCreate}
                onClick={() => setWizardOpen(true)}
                data-testid="new-dashboard"
              >
                New dashboard
              </Button>
            </Tooltip>
          )
        }
      />

      {!openId ? (
        // The gallery: what a reader is choosing between is a layout, so each
        // card says what its dashboard holds.
        items.length === 0 ? (
          <Card size="small">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No dashboards yet. One is three steps away."
            >
              {canCreate && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>
                  New dashboard
                </Button>
              )}
            </Empty>
          </Card>
        ) : (
          <div className="nu-boards" data-testid="dashboard-gallery">
            {items.map((item) => (
              <DashboardCard
                key={item.id}
                dashboard={item}
                open={false}
                onOpen={() => open(item.id)}
                onSettings={() => {
                  open(item.id);
                  setSettingsOpen(true);
                }}
                onDelete={() =>
                  modal.confirm({
                    title: `Delete ${item.name}?`,
                    content: "The layout goes. Nothing it pointed at is affected.",
                    okText: "Delete",
                    okButtonProps: { danger: true },
                    onOk: async () => {
                      await dashboardsApi.remove(item.id);
                      message.success(`${item.name} deleted`);
                      void queryClient.invalidateQueries({ queryKey: ["dashboards"] });
                    },
                  })
                }
              />
            ))}
          </div>
        )
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
          action={
            <Button size="small" onClick={() => open("")}>
              All dashboards
            </Button>
          }
        />
      ) : widgets.length === 0 ? (
        <Card size="small">
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
        <div data-testid="dashboard-grid">
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

      <CreateDashboardWizard
        open={wizardOpen}
        canShare={listing.data?.can_share ?? false}
        unavailable={unavailable}
        onClose={() => setWizardOpen(false)}
        onCreated={(saved) => {
          setWizardOpen(false);
          settled(saved);
          open(saved.id);
          setEditing(true);
          message.success(`${saved.name} created`);
        }}
      />

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
          const wanted = KINDS[chosen];
          onSave({
            kind: chosen,
            title: values["title"] ?? "",
            subtitle: values["subtitle"] || null,
            // The size a new widget gets comes from the server, which is the
            // one place that knows a KPI wants three columns. An edited one
            // keeps where the reader put it.
            ...(widget ? {} : { x: 0 }),
            // The kind decides what the config may hold, because the server
            // refuses a dataset on a feed and a dataset on a reference — both
            // would be a second opinion about where the data comes from.
            config: wanted.needs === "nothing"
              ? {}
              : wanted.needs === "report"
                ? { report_id: values["report_id"] ?? "" }
                : wanted.needs === "search"
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
            // Searchable, because thirteen kinds is more than a list somebody
            // reads top to bottom — and typing "heat" is faster than
            // scrolling past six chart shapes to reach it.
            showSearch
            optionFilterProp="label"
            // Ordered the way the picker orders them, and named the same —
            // one vocabulary for the kinds, wherever they are offered.
            options={KIND_ORDER.filter((item) => kinds.includes(item)).map((item) => ({
              value: item,
              label: KINDS[item].label,
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
