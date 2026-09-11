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
  AppstoreOutlined,
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
import { reportsApi } from "@/api/reports";
import { PageHeader } from "@/components/PageHeader";
import { MemberPicker } from "@/components/PeoplePicker";
import { WidgetBody } from "@/components/dashboards/WidgetBody";
import { CreateDashboardWizard } from "@/components/dashboards/CreateDashboardWizard";
import { WidgetModal } from "@/components/dashboards/WidgetModal";
import { DashboardCard } from "@/components/dashboards/DashboardCard";
import { ShareDrawer } from "@/components/dashboards/ShareDrawer";
import { WidgetCard, type WidgetMoves } from "@/components/dashboards/WidgetCard";
import {
  WidgetGrid,
  autoArranged,
  compacted,
  minimumFor,
  MAX_ROWS,
} from "@/components/dashboards/WidgetGrid";
import { usePageCommands } from "@/commands/CommandContext";
import { asText } from "@/lib/text";
import { relativeTime } from "@/lib/time";
import { useDiscardGuard } from "@/hooks/useDiscardGuard";
import { useSticky } from "@/hooks/useSticky";
import { COPY_MEANS, confirmCopy } from "@/lib/confirm";
import { EmptyState } from "@/components/EmptyState";

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
  /**
   * The window the chart-shaped widgets read over.
   *
   * There is deliberately **no period control on this page**. A dashboard here
   * is a set of windows onto the product — what is in the inbox, what is in
   * the lane, what lands this week — and almost none of that has a period at
   * all; offering one above them implied every card answered to it, and put a
   * prominent control on a page where most of the widgets ignored it. The
   * charts that do need a window take the dashboard's saved default, which
   * lives in Settings where an owner sets it once, and any widget may name its
   * own (§45).
   */
  const period = asText(board?.filters["period"]) || "last_30_days";

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
                  {/* Two arrangers, because they answer different questions.
                      "Tidy up" is the rule the grid already applies during a
                      drag — close the gaps, leave everything where it is —
                      and it is what somebody wants after moving one card.
                      "Auto-arrange" also *packs the rows*, which is the only
                      thing that rescues a dashboard whose cards were each
                      dropped under the last and left half the width empty. */}
                  <Button
                    icon={<ColumnHeightOutlined />}
                    loading={arrange.isPending}
                    disabled={widgets.length === 0}
                    onClick={() => arrange.mutate(compacted(widgets, columns))}
                    data-testid="tidy-up"
                  >
                    Tidy up
                  </Button>
                  <Button
                    icon={<AppstoreOutlined />}
                    loading={arrange.isPending}
                    disabled={widgets.length === 0}
                    onClick={() => arrange.mutate(autoArranged(widgets, columns))}
                    data-testid="auto-arrange"
                  >
                    Auto-arrange
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
                  onClick={() =>
                    confirmCopy(modal, {
                      what: board.name,
                      consequence:
                        "Every widget keeps pointing at the same reports and searches — a copy of the layout, not of the data. " + COPY_MEANS,
                      onOk: () => duplicate.mutateAsync(board.id),
                    })
                  }
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
            <EmptyState compact title="No dashboards yet. One is three steps away." action={<>{canCreate && (
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizardOpen(true)}>
                  New dashboard
                </Button>
              )}</>} />
          </Card>
        ) : (
          <div className="nu-boards" data-testid="dashboard-gallery">
            {items.map((item) => (
              <DashboardCard
                key={item.id}
                dashboard={item}
                open={false}
                canCopy={canCreate}
                onCopy={() =>
                  confirmCopy(modal, {
                    what: item.name,
                    consequence:
                      "Every widget keeps pointing at the same reports and searches — a copy of the layout, not of the data. " + COPY_MEANS,
                    onOk: () => duplicate.mutateAsync(item.id),
                  })
                }
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
            <Button onClick={() => open("")}>
              All dashboards
            </Button>
          }
        />
      ) : widgets.length === 0 ? (
        <Card size="small">
          <EmptyState compact title="No widgets yet" action={<>{board?.can_edit && (
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
            )}</>} />
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

      <WidgetModal
        open={widgetForm !== null}
        widget={widgetForm === "new" ? null : widgetForm}
        datasets={listing.data?.datasets ?? []}
        kinds={listing.data?.widget_kinds ?? []}
        saving={saveWidget.isPending}
        period={period}
        resources={resources.data?.items ?? []}
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
