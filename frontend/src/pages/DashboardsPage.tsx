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
  CopyOutlined,
  PlusOutlined,
  SettingOutlined,
  ShareAltOutlined,
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
import { kanbanApi } from "@/api/kanban";
import { reportsApi } from "@/api/reports";
import { PageHeader } from "@/components/PageHeader";
import { MemberPicker } from "@/components/PeoplePicker";
import { WidgetBody } from "@/components/dashboards/WidgetBody";
import { CreateDashboardWizard } from "@/components/dashboards/CreateDashboardWizard";
import {
  FAMILY_LABELS,
  KINDS,
  KIND_FAMILIES,
  kindsOf,
} from "@/components/dashboards/kinds";
import { DashboardCard } from "@/components/dashboards/DashboardCard";
import { ShareDrawer } from "@/components/dashboards/ShareDrawer";
import { WidgetCard, type WidgetMoves } from "@/components/dashboards/WidgetCard";
import { WidgetGrid, compacted, minimumFor, MAX_ROWS } from "@/components/dashboards/WidgetGrid";
import { usePageCommands } from "@/commands/CommandContext";
import { asText } from "@/lib/text";
import { relativeTime } from "@/lib/time";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { useSticky } from "@/hooks/useSticky";

const { Text } = Typography;

export default function DashboardsPage() {
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [widgetForm, setWidgetForm] = useState<DashboardWidget | "new" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
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

  /**
   * Whether the layout editor is open, remembered per dashboard (§72).
   *
   * Not in the URL and not on the server, because it is neither: a colleague
   * opening the same address should not land in an editor, and the owner
   * reloading mid-rearrange should not be dropped back into reading mode with
   * the drawer they had open gone. Per dashboard rather than per page, because
   * "I am building this one" and "I am reading that one" are true at once.
   */
  const [editing, setEditing] = useSticky<boolean>(`dashboards.editing.${openId}`, false);

  /**
   * The period this reader is looking through, when it is not the one saved.
   *
   * A dashboard's own period is part of the object — the owner chose it and
   * everybody sees it. But somebody reading a shared dashboard wants last
   * quarter without changing what their colleagues see, so an override lives
   * here and sticks to this reader. Empty means "whatever the dashboard says".
   */
  const [periodOverride, setPeriodOverride] = useSticky<string>(`dashboards.period.${openId}`, "");

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

  /**
   * One drag's worth of geometry, applied here first and then confirmed.
   *
   * The layout is already on the server the moment a gesture ends — that is
   * what makes it survive a refresh. What this adds is the half-second in
   * between: without it the card snaps back to where it was until the response
   * lands, which reads as the drag having failed and makes people drag again.
   *
   * The cache is written, not a second copy of the layout, so a refused move
   * still snaps back: `onError` restores what the server last said, and
   * `onSettled` refetches. A local layout that outlived the refusal would be a
   * dashboard that looks rearranged and is not (§73).
   */
  const arrange = useMutation({
    mutationFn: (placements: Placement[]) => dashboardsApi.arrange(openId, placements),
    onMutate: async (placements: Placement[]) => {
      await queryClient.cancelQueries({ queryKey: ["dashboard", openId] });
      const previous = queryClient.getQueryData<SavedDashboard>(["dashboard", openId]);
      if (previous?.widgets) {
        const geometry = new Map(placements.map((item) => [item.id, item]));
        queryClient.setQueryData<SavedDashboard>(["dashboard", openId], {
          ...previous,
          widgets: previous.widgets.map((widget) => {
            const placed = geometry.get(widget.id);
            return placed
              ? { ...widget, x: placed.x, y: placed.y, width: placed.width, height: placed.height }
              : widget;
          }),
        });
      }
      return { previous };
    },
    onSuccess: settled,
    onError: (error, _placements, context) => {
      if (context?.previous) queryClient.setQueryData(["dashboard", openId], context.previous);
      failed(error);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["dashboard", openId] }),
  });

  /** A colleague's layout, adopted as your own so you can adapt it. */
  const duplicate = useMutation({
    mutationFn: (id: string) => dashboardsApi.duplicate(id),
    onSuccess: (saved) => {
      settled(saved);
      open(saved.id);
      message.success(`Copied as ${saved.name} — it is yours to change`);
    },
    onError: failed,
  });

  const board = dashboard.data;
  const columns = board?.columns ?? listing.data?.columns ?? 12;
  const widgets = board?.widgets ?? [];
  /** The dashboard's own period, unless this reader chose another (§72). */
  const savedPeriod = asText(board?.filters["period"]) || "last_30_days";
  const period = periodOverride || savedPeriod;

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
      const floor = minimumFor(widget.kind);
      // Never below what the kind can be drawn at. A three-column chart nudged
      // to one column is a card the server accepts and nobody can read.
      const width = Math.max(floor.w, Math.min(columns, widget.width + dWidth));
      rewrite({
        ...widget,
        width,
        // Kept inside the grid here as well as on the server: a control that
        // produces a refusal every time it is pressed at the right edge is a
        // control nobody presses twice.
        x: Math.min(widget.x, columns - width),
        height: Math.max(floor.h, Math.min(MAX_ROWS, widget.height + dHeight)),
      });
    },
    setSize: (widget, width, height) => {
      const floor = minimumFor(widget.kind);
      const wanted = Math.max(floor.w, Math.min(columns, width));
      rewrite({
        ...widget,
        width: wanted,
        x: Math.min(widget.x, columns - wanted),
        height: Math.max(floor.h, Math.min(MAX_ROWS, height)),
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
              {/* The period every widget follows unless it names its own.
                  Here rather than only in settings, because it is the control
                  a reader reaches for most and settings is where an *owner*
                  changes an object. Changing it as a reader is a preference
                  that sticks to this reader (§72); the owner's saved choice is
                  what anybody else opening the dashboard still sees. */}
              <Select
                aria-label="Period"
                value={period}
                onChange={(next) => setPeriodOverride(next === savedPeriod ? "" : next)}
                popupMatchSelectWidth={false}
                data-testid="dashboard-period"
                options={[
                  { value: "all_time", label: "All time" },
                  { value: "last_7_days", label: "Last 7 days" },
                  { value: "last_30_days", label: "Last 30 days" },
                  { value: "last_90_days", label: "Last 90 days" },
                  { value: "last_365_days", label: "Last 365 days" },
                ]}
              />
              {periodOverride && periodOverride !== savedPeriod && (
                <Tooltip title={`The dashboard itself is set to ${savedPeriod.replace(/_/g, " ")}`}>
                  <Button size="small" type="link" onClick={() => setPeriodOverride("")}>
                    Reset
                  </Button>
                </Tooltip>
              )}
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
              {/* Adopting somebody else's layout, which is the thing that
                  makes sharing worth having. Offered exactly when it is the
                  useful move — on a dashboard this reader cannot change. */}
              {!board.can_edit && canCreate && (
                <Button
                  icon={<CopyOutlined />}
                  loading={duplicate.isPending}
                  onClick={() => duplicate.mutate(board.id)}
                  data-testid="duplicate-dashboard"
                >
                  Make a copy
                </Button>
              )}
              {board.can_edit && (
                <Button
                  icon={<ShareAltOutlined />}
                  onClick={() => setShareOpen(true)}
                  data-testid="board-share"
                >
                  Share
                </Button>
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
                canCopy={canCreate}
                onCopy={() => duplicate.mutate(item.id)}
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
                columns={columns}
                moves={moves}
              >
                <WidgetBody
                  widget={widget}
                  period={period}
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

      <ShareDrawer
        open={shareOpen}
        dashboard={board}
        saving={saveBoard.isPending}
        canShare={listing.data?.can_share ?? false}
        onClose={() => setShareOpen(false)}
        onSave={(input) => {
          saveBoard.mutate(input);
          setShareOpen(false);
        }}
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
  // A widget's question is several choices — a dataset, a dimension, a
  // period — and closing the drawer would take them all (§74).
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

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      width={460}
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
          touch();
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
        <Form.Item
          name="kind"
          label="What kind"
          extra={KINDS[kind].question}
        >
          <Select
            aria-label="Widget kind"
            // Searchable, because twenty-six kinds is more than a list somebody
            // reads top to bottom — and typing "heat" is faster than scrolling
            // past six chart shapes to reach it.
            showSearch
            optionFilterProp="label"
            // Grouped by family and named the way the picker names them — one
            // vocabulary for the kinds, wherever they are offered. Flat, this
            // list was twenty-six unrelated words.
            options={KIND_FAMILIES.map((family) => ({
              label: FAMILY_LABELS[family].label,
              options: kindsOf(family, kinds).map((item) => ({
                value: item,
                label: KINDS[item].label,
              })),
            })).filter((group) => group.options.length > 0)}
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
    </Drawer>
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
  const { touch, requestClose } = useDiscardGuard({ close: onClose, what: "dashboard" });
  if (!dashboard) return null;

  return (
    <Drawer
      open={open}
      onClose={requestClose}
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
        onValuesChange={touch}
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
