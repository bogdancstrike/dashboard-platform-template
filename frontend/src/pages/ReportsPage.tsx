/**
 * `/reports` — the questions worth asking again (§28).
 *
 * A report is a saved analysis, so this page is a list of questions and one
 * answer: pick a report on the left, read its result on the right. That shape
 * is deliberate — a gallery of report *names* makes somebody click through
 * five of them to find the one they meant, and a page that runs all of them
 * runs five aggregate queries to show one.
 *
 * The answer is computed by the same compiler the analytics workspace uses, so
 * a report and the screen it was built on cannot disagree about the same data.
 * The result is drawn with the platform's own chart renderer, which means it
 * is also readable as a table and exportable as CSV without anything here
 * knowing how either works (§30).
 *
 * Sharing is the saved-search model, and the page says which of the three
 * states a report is in rather than leaving the reader to guess who else can
 * see it.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Dropdown,
  Input,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CopyOutlined,
  DashboardOutlined,
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  LockOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { panelFor } from "@/api/analysis";
import { reportsApi, type SavedReport } from "@/api/reports";
import type { ChartKind } from "@/api/dashboard";
import { ChartCard } from "@/components/ChartCard";
import { AddToDashboard, type DashboardSubject } from "@/components/dashboards/AddToDashboard";
import { FailureAlert } from "@/components/FailureAlert";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { NxIcon } from "@/components/NxIcon";
import { usePageCommands } from "@/commands/CommandContext";
import { relativeTime } from "@/lib/time";
import { FEATURES, useFeature } from "@/settings/features";
import { queryKeys } from "@/lib/queryKeys";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";

const { Text } = Typography;

/** What each visibility looks like, so the state is read rather than deduced. */
/** `preset` and not `colour`: these are AntD preset *names*, whose ink
 * `index.css` fixes. A field called colour is where a hex ends up, and a hex
 * on a `Tag` is a filled tag with white text on it (§55) — see `EdgeTag`. */
const SCOPES: Record<string, { icon: React.ReactNode; label: string; preset?: string }> = {
  PRIVATE: { icon: <LockOutlined />, label: "Private" },
  SHARED: { icon: <TeamOutlined />, label: "Shared", preset: "blue" },
  PUBLIC: { icon: <GlobalOutlined />, label: "Public", preset: "green" },
};

export default function ReportsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [params, setParams] = useSearchParams();
  const [term, setTerm] = useState("");
  /** The report on its way to a dashboard, or nothing (§45). */
  const [pinning, setPinning] = useState<DashboardSubject | null>(null);
  // "Add to a dashboard" is the dashboard builder's (§27).
  const dashboardsOn = useFeature(FEATURES.dashboardBuilder);

  const reports = useQuery({
    queryKey: queryKeys.reports(),
    queryFn: ({ signal }) => reportsApi.list(signal),
  });

  // Memoised because the filter below depends on it: a fresh `[]` on every
  // render would re-filter the list on every keystroke elsewhere on the page.
  const items = useMemo(() => reports.data?.items ?? [], [reports.data]);
  const openId = params.get("report") ?? items[0]?.id ?? "";
  const open = items.find((item) => item.id === openId);

  const [which, setWhich] = useState<"all" | "scheduled" | "mine" | "shared">("all");
  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    const narrowed = items.filter((item) =>
      which === "scheduled"
        ? Boolean(item.schedule)
        : which === "mine"
          ? item.can_edit
          : which === "shared"
            ? !item.can_edit
            : true,
    );
    if (!needle) return narrowed;
    return narrowed.filter((item) =>
      [item.name, item.description ?? "", item.owner.name, item.resource_type]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, term, which]);

  const run = useQuery({
    queryKey: queryKeys.reportRun(openId),
    queryFn: ({ signal }) => reportsApi.run(openId, {}, signal),
    enabled: Boolean(openId),
    placeholderData: (previous) => previous,
  });

  const choose = (id: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set("report", id);
        return next;
      },
      // Pushed: each report opened is a place back returns to.
      { replace: false },
    );

  const duplicate = useMutation({
    mutationFn: (id: string) => reportsApi.duplicate(id),
    onSuccess: (copy) => {
      message.success(`${copy.name} is yours to change`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports() });
      choose(copy.id);
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That report could not be copied."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => reportsApi.remove(id),
    onSuccess: () => {
      message.success("Report deleted");
      void queryClient.invalidateQueries({ queryKey: queryKeys.reports() });
      setParams(new URLSearchParams(), { replace: true });
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That report could not be deleted."),
  });

  usePageCommands("reports", [
    {
      id: "reports.new",
      label: "Build a report",
      keywords: "new create analysis",
      run: () => navigate("/reports/builder"),
    },
    {
      id: "reports.rerun",
      label: "Run this report again",
      keywords: "refresh reload",
      run: () => void run.refetch(),
    },
  ]);

  if (reports.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (reports.isError) {
    const error = reports.error;
    return (
      <>
        <PageHeader title="Reports" />
        <Alert
          type={error instanceof ApiError && error.isForbidden ? "warning" : "error"}
          showIcon
          message={error instanceof ApiError ? error.message : "Reports could not be loaded."}
          description={apiErrorDetails(error, 2)}
          action={
            <Button onClick={() => void reports.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const canCreate = reports.data?.can_create ?? false;

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={[
          `${items.length.toLocaleString()} saved`,
          `${items.filter((item) => item.schedule).length} scheduled`,
          `${items.filter((item) => item.last_run_at && new Date(item.last_run_at).toDateString() === new Date().toDateString()).length} run today`,
        ].join(" · ")}
        tag={<Tag color="blue">{items.length.toLocaleString()} saved</Tag>}
        actions={
          <Tooltip title={canCreate ? "" : "Your role does not include reports.manage"}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!canCreate}
              onClick={() => navigate("/reports/builder")}
              data-testid="new-report"
            >
              Build a report
            </Button>
          </Tooltip>
        }
      />

      {/* A workbench: the questions on the left, the answer on the right,
          filling the window. Sized to its content, the answer left a third of
          the screen blank under it and the list was capped at two thirds of
          the viewport whether or not there was room. */}
      <div className="nx-ov-reports" data-testid="reports">
        {/* The reports as the canvas lays them out — one table, a row each,
            with what the server knows about them in columns. The chosen row
            is answered underneath, so the page still opens on an answer
            rather than on a list of names. */}
        <Card size="small" className="nx-ov-reportlist">
          <div className="nx-ov-filterbar nx-ov-filterbar--inset" role="search">
            <Input
              allowClear
              variant="filled"
              prefix={<NxIcon name="search" size={16} />}
              placeholder="Search reports"
              aria-label="Filter reports"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>
          <div className="nu-kindstrip nx-ov-kinds" aria-label="Which reports">
            {(
              [
                ["all", "All", items.length],
                ["scheduled", "Scheduled", items.filter((item) => item.schedule).length],
                ["mine", "Mine", items.filter((item) => item.can_edit).length],
                ["shared", "Shared with me", items.filter((item) => !item.can_edit).length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                className={`nu-kindchip${which === key ? " is-active" : ""}${count === 0 ? " is-empty" : ""}`}
                aria-pressed={which === key}
                disabled={count === 0 && key !== "all"}
                onClick={() => setWhich(key)}
              >
                <span className="nu-kindchip-label">{label}</span>
                <span className="nu-kindchip-count">{count}</span>
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            items.length === 0 ? (
              <EmptyState
                title="No reports yet"
                hint="A report is a saved analysis — a dataset, a way to cut it and a period."
                action={
                  canCreate ? (
                    <Button type="primary" onClick={() => navigate("/reports/builder")}>
                      Build the first one
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <EmptyState title={term ? `Nothing matches “${term}”` : "Nothing in this view"} />
            )
          ) : (
            <Table<SavedReport>
              rowKey="id"
              dataSource={filtered}
              size="middle"
              pagination={filtered.length > 6 ? { pageSize: 6, size: "small", showSizeChanger: false } : false}
              rowClassName={(report) => `nu-queue-row${report.id === openId ? " is-open" : ""}`}
              onRow={(report) => ({
                onClick: () => choose(report.id),
                onKeyDown: (event) => {
                  if (event.key === "Enter") choose(report.id);
                },
                tabIndex: 0,
                "aria-current": report.id === openId,
              })}
              scroll={{ x: 640 }}
              columns={[
                {
                  key: "report",
                  title: "Report",
                  render: (_, report) => (
                    <span className="nu-queue-main">
                      <span className="nu-queue-title">
                        <Text strong ellipsis>
                          {report.name}
                        </Text>
                        {/* Only the exceptions carry a mark: private is the
                            default, and a label every row shares is a label
                            nobody reads. */}
                        {report.scope !== "PRIVATE" && (
                          <Tooltip title={SCOPES[report.scope]?.label}>
                            <span className="nu-queue-scope" aria-label={SCOPES[report.scope]?.label}>
                              {SCOPES[report.scope]?.icon}
                            </span>
                          </Tooltip>
                        )}
                      </span>
                      <Text type="secondary" className="nx-ov-sub">
                        {[report.can_edit ? "You" : report.owner.name, report.resource_type.replace(/_/g, " ")].join(" · ")}
                      </Text>
                    </span>
                  ),
                },
                {
                  key: "schedule",
                  title: "Schedule",
                  width: 170,
                  render: (_, report) =>
                    report.schedule ? (
                      <Text>{report.schedule}</Text>
                    ) : (
                      <Text type="secondary">Not scheduled</Text>
                    ),
                },
                {
                  key: "chart",
                  title: "Chart",
                  width: 110,
                  render: (_, report) => (
                    <Tag bordered={false} className="nx-ov-pill">
                      {report.visualization.replace(/[-_]/g, " ")}
                    </Tag>
                  ),
                },
                {
                  key: "runs",
                  title: "Runs",
                  width: 80,
                  align: "right",
                  render: (_, report) => report.run_count.toLocaleString(),
                },
                {
                  key: "last",
                  title: "Last run",
                  width: 130,
                  render: (_, report) =>
                    report.last_run_at ? (
                      relativeTime(report.last_run_at)
                    ) : (
                      <Text type="secondary">Never</Text>
                    ),
                },
              ]}
            />
          )}
        </Card>

        <Card
          size="small"
          className="nu-pane nu-split-detail nx-ov-reportdetail"
          title={open?.name ?? "Pick a report"}
          extra={
            open && (
              <Space>
                <Button
                  icon={<ReloadOutlined />}
                  loading={run.isFetching}
                  onClick={() => void run.refetch()}
                >
                  Run again
                </Button>
                <Dropdown
                  trigger={["click"]}
                  menu={{
                    items: [
                      {
                        key: "edit",
                        icon: <EditOutlined />,
                        label: open.can_edit ? "Edit" : "Edit — only the owner may",
                        disabled: !open.can_edit,
                      },
                      ...(dashboardsOn
                        ? [{
                            key: "dashboard",
                            icon: <DashboardOutlined />,
                            label: "Add to a dashboard",
                          }]
                        : []),
                      { key: "duplicate", icon: <CopyOutlined />, label: "Duplicate" },
                      {
                        key: "delete",
                        icon: <DeleteOutlined />,
                        label: open.can_edit ? "Delete" : "Delete — only the owner may",
                        disabled: !open.can_edit,
                        danger: open.can_edit,
                      },
                    ],
                    onClick: ({ key }) => {
                      if (key === "edit") navigate(`/reports/builder?id=${open.id}`);
                      // The saved report itself goes on the dashboard, not a
                      // copy of its question (§45).
                      else if (key === "dashboard")
                        setPinning({ kind: "REPORT", id: open.id, title: open.name });
                      else if (key === "duplicate") duplicate.mutate(open.id);
                      else
                        modal.confirm({
                          title: `Delete ${open.name}?`,
                          content: "Anybody it was shared with loses it too.",
                          okText: "Delete",
                          okButtonProps: { danger: true },
                          onOk: () => remove.mutateAsync(open.id),
                        });
                    },
                  }}
                >
                  <Button icon={<MoreOutlined />} aria-label={`Actions for ${open.name}`} />
                </Dropdown>
              </Space>
            )
          }
        >
          {!open ? (
            <EmptyState title="Choose a report from the list" />
          ) : run.isError ? (
            <FailureAlert
              error={run.error}
              titles={{
                forbidden: "Your role does not include this report",
                not_found: "That report has been deleted",
                failed: "That report could not be run",
              }}
              onRetry={() => void run.refetch()}
            />
          ) : (
            <>
              {/* One line of provenance and one control, so the answer starts
                  as high on the page as it can. This was four stacked blocks
                  — tags, a description, a period strip, then the chart — and
                  the chart got what was left. */}
              <div className="nu-report-meta">
                <Space size={8} wrap>
                  <ScopeTag report={open} />
                  <Text type="secondary">by {open.owner.name}</Text>
                  <Text type="secondary">·</Text>
                  <Text type="secondary">
                    run {open.run_count.toLocaleString()} times
                  </Text>
                  <Text type="secondary">·</Text>
                  <Text type="secondary" data-testid="report-matched">
                    {(run.data?.result.matched ?? 0).toLocaleString()} rows measured
                  </Text>
                  {open.members.length > 0 && (
                    <Tooltip title={open.members.map((member) => member.name).join(", ")}>
                      <Tag bordered={false}>{open.members.length} members</Tag>
                    </Tooltip>
                  )}
                </Space>

                <Segmented
                  size="small"
                  aria-label="Period"
                  value={run.data?.result.period.key ?? open.period}
                  onChange={(next) => void rerun(String(next))}
                  options={[
                    { value: "last_30_days", label: "30 days" },
                    { value: "last_90_days", label: "90 days" },
                    { value: "last_365_days", label: "A year" },
                    { value: "all_time", label: "All time" },
                  ]}
                />
              </div>

              {open.description && (
                <Text type="secondary" className="nu-report-description">
                  {open.description}
                </Text>
              )}

              <ChartCard
                id={`report-${open.id}`}
                className="nu-chartcard--fill"
                height="100%"
                loading={run.isLoading}
                panel={panelFor(
                  run.data?.result,
                  (open.visualization === "table" ? "bar" : open.visualization) as ChartKind,
                  undefined,
                  run.data?.result.description,
                )}
              />
            </>
          )}
        </Card>
      </div>

      <AddToDashboard
        open={pinning !== null}
        subject={pinning}
        onClose={() => setPinning(null)}
      />
    </>
  );

  /** Re-run the open report over a different period, without saving it. */
  async function rerun(period: string) {
    if (!open) return;
    const result = await reportsApi.run(open.id, { period });
    queryClient.setQueryData(queryKeys.reportRun(open.id), result);
  }
}

function ScopeTag({ report }: { report: SavedReport }) {
  const scope = SCOPES[report.scope] ?? SCOPES["PRIVATE"]!;
  return (
    <Tag icon={scope.icon} color={scope.preset} bordered={false}>
      {scope.label}
    </Tag>
  );
}
