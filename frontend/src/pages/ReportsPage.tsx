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
  Empty,
  Input,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CopyOutlined,
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
import { FailureAlert } from "@/components/FailureAlert";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { relativeTime } from "@/lib/time";

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

  const reports = useQuery({
    queryKey: ["reports"],
    queryFn: ({ signal }) => reportsApi.list(signal),
  });

  // Memoised because the filter below depends on it: a fresh `[]` on every
  // render would re-filter the list on every keystroke elsewhere on the page.
  const items = useMemo(() => reports.data?.items ?? [], [reports.data]);
  const openId = params.get("report") ?? items[0]?.id ?? "";
  const open = items.find((item) => item.id === openId);

  const filtered = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.name, item.description ?? "", item.owner.name, item.resource_type]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    );
  }, [items, term]);

  const run = useQuery({
    queryKey: ["report-run", openId],
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
      { replace: true },
    );

  const duplicate = useMutation({
    mutationFn: (id: string) => reportsApi.duplicate(id),
    onSuccess: (copy) => {
      message.success(`${copy.name} is yours to change`);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      choose(copy.id);
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That report could not be copied."),
  });

  const remove = useMutation({
    mutationFn: (id: string) => reportsApi.remove(id),
    onSuccess: () => {
      message.success("Report deleted");
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
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
          description={
            error instanceof ApiError ? (
              <Space direction="vertical" size={2}>
                {error.missingPermissions.length > 0 && (
                  <Text type="secondary">Missing: {error.missingPermissions.join(", ")}</Text>
                )}
                <Text code copyable={{ text: error.correlationId }}>
                  {error.correlationId}
                </Text>
              </Space>
            ) : undefined
          }
          action={
            <Button size="small" onClick={() => void reports.refetch()}>
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
        subtitle="Saved questions, answered by the same engine the analytics workspace uses."
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
      <div className="nu-split nu-fill" data-testid="reports">
        <Card size="small" className="nu-pane nu-split-list">
          <Input.Search
            allowClear
            placeholder="Filter reports"
            aria-label="Filter reports"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            className="nu-block"
          />

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
              <Empty description={`Nothing matches “${term}”`} />
            )
          ) : (
            <ul className="nu-queue">
              {filtered.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    className={`nu-queue-row${report.id === openId ? " is-open" : ""}`}
                    onClick={() => choose(report.id)}
                    aria-current={report.id === openId}
                  >
                    <span className="nu-queue-main">
                      <span className="nu-queue-title">
                        <Text strong ellipsis>
                          {report.name}
                        </Text>
                        {/* Only the exceptions carry a mark. Private is the
                            default and was tagged on every single row — a
                            label every row shares is a label nobody reads. */}
                        {report.scope !== "PRIVATE" && (
                          <Tooltip title={SCOPES[report.scope]?.label}>
                            <span className="nu-queue-scope" aria-label={SCOPES[report.scope]?.label}>
                              {SCOPES[report.scope]?.icon}
                            </span>
                          </Tooltip>
                        )}
                      </span>
                      <span className="nu-queue-meta">
                        <Text type="secondary">{report.resource_type}</Text>
                        <Text type="secondary">·</Text>
                        <Text type="secondary">
                          {report.last_run_at
                            ? `run ${relativeTime(report.last_run_at)}`
                            : "never run"}
                        </Text>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          size="small"
          className="nu-pane nu-split-detail"
          title={open?.name ?? "Pick a report"}
          extra={
            open && (
              <Space>
                <Button
                  size="small"
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
                  <Button size="small" icon={<MoreOutlined />} aria-label={`Actions for ${open.name}`} />
                </Dropdown>
              </Space>
            )
          }
        >
          {!open ? (
            <Empty description="Choose a report from the list" />
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
    </>
  );

  /** Re-run the open report over a different period, without saving it. */
  async function rerun(period: string) {
    if (!open) return;
    const result = await reportsApi.run(open.id, { period });
    queryClient.setQueryData(["report-run", open.id], result);
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
