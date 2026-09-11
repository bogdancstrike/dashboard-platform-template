/**
 * `/admin/jobs` — what ran, what failed, and what can be tried again (§23).
 *
 * Five decisions worth stating.
 *
 * **Every control asks the server whether it is allowed.** `can_retry` and
 * `can_cancel` arrive on each row; this page never decides for itself whether a
 * job may be retried. The rules are stateful — terminal or not, within
 * `max_attempts` or not, a kind this console owns or not — and a browser
 * re-deriving them would eventually draw a button the endpoint refuses, which
 * is worse than no button. `whyNot` only *explains* the answer; it never
 * decides it.
 *
 * **A refusal is a disabled control with the reason, not a missing one.**
 * Retrying a running job is something an operator will reasonably *try*; the
 * answer is "not while it is running", said before they click (§76). Contrast
 * the settings page, where a card a reader may not open is absent — there the
 * reason is a permission, which will not change while they look at it.
 *
 * **Progress is a number and a bar, not a bar.** A bar alone cannot be read
 * out, compared between rows, or seen by somebody who cannot distinguish its
 * fill from its track (§64) — and "40%" of what matters, so the units are
 * beside it.
 *
 * **Attempts are on the face of the row.** "Failed" and "failed three times"
 * are different problems, and a queue that shows only the latest status makes
 * the second one invisible until somebody opens each row.
 *
 * **The status strip counts the whole queue, not the page.** Clicking a status
 * narrows the table and leaves the counts alone, so the strip stays a map of
 * the queue rather than a description of what is currently on screen (§71).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Descriptions,
  Drawer,
  Input,
  Popconfirm,
  Progress,
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { PlusOutlined, RedoOutlined, StopOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { jobsApi, type Job, type JobDetail, type JobStatus } from "@/api/jobs";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { absoluteTime, relativeTime } from "@/lib/time";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

/** The three things `jobs.manage` can do to a job. */
type Verb = "retry" | "cancel" | "grant";

/**
 * The colour a status earns.
 *
 * Never the only carrier (§64): the status is written out beside it. RETRYING
 * gets the warning tone rather than the error one on purpose — "failed and
 * will be tried again" is a different state from "failed", and an operator
 * scanning for what needs them should not be pulled to a row already handling
 * itself.
 */
export function toneFor(status: JobStatus): string | undefined {
  switch (status) {
    case "FAILED":
      return "error";
    case "RETRYING":
      return "warning";
    case "SUCCEEDED":
      return "success";
    case "RUNNING":
      return "processing";
    case "QUEUED":
      return "default";
    default:
      return undefined;
  }
}

/**
 * Why a control is unavailable, in the words an operator needs.
 *
 * Exported and asserted directly, because this *is* the §76 rule for this
 * page: a disabled button whose tooltip says "not allowed" has told nobody
 * anything, and the two reasons a retry is refused are genuinely different
 * problems with different fixes.
 */
export function whyNot(job: Job, action: "retry" | "cancel"): string | null {
  if (action === "retry") {
    if (job.can_retry) return null;
    // Checked before the attempt count, because it is the reason that stands
    // whatever the attempts say: an export is re-requested rather than
    // retried, and telling somebody to grant it more attempts would send them
    // after a fix that changes nothing (§30).
    if (job.kind === "EXPORT") {
      return "Exports are re-requested rather than retried — the rows have moved on since this one was asked for. Ask again on the Exports page.";
    }
    if (job.attempt >= job.max_attempts) {
      return job.can_allow_attempts
        ? `All ${job.max_attempts} attempts have been used. Grant it more to run it again.`
        : `All ${job.max_attempts} attempts have been used, and that is the most one job may be granted.`;
    }
    return `It is ${job.status.toLowerCase()} and has not finished — retrying now would run it twice over the same records.`;
  }
  if (job.can_cancel) return null;
  return `It already finished as ${job.status.toLowerCase()}. There is nothing left to stop.`;
}

/** How a job's own progress reads, in words as well as a bar. */
export function progressLabel(job: Job): string {
  if (job.total_units === 0) return `${job.progress}%`;
  const done = job.processed_units.toLocaleString();
  const total = job.total_units.toLocaleString();
  return job.failed_units > 0
    ? `${done} of ${total}, ${job.failed_units.toLocaleString()} failed`
    : `${done} of ${total}`;
}

export default function JobsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();

  const [box, setBox] = useState(params.get("q") ?? "");
  const term = useDebouncedValue(box, 250);
  const status = params.get("status") ?? "";
  const queue = params.get("queue") ?? "";
  const page = Number(params.get("page") ?? 1);
  const [opened, setOpened] = useState<string | null>(null);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        if (!("page" in changes)) next.delete("page");
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    set({ q: term || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const filters = {
    ...(term ? { q: term } : {}),
    ...(status ? { status } : {}),
    ...(queue ? { queue } : {}),
  };

  const catalogue = useQuery({
    queryKey: ["jobs", "catalogue"],
    queryFn: ({ signal }) => jobsApi.catalogue(signal),
    staleTime: 30_000,
  });

  const listing = useQuery({
    queryKey: ["jobs", "list", filters, page],
    queryFn: ({ signal }) => jobsApi.list({ ...filters, page, page_size: 25 }, signal),
    // A queue moves, so this page opens with a refresh already running — the
    // one page where watching progress *is* the job. It is the reader's to
    // change or turn off, which is what it was not while the interval was a
    // constant here (§53).
  });

  const detail = useQuery({
    queryKey: ["jobs", "entry", opened],
    queryFn: ({ signal }) => jobsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const act = useMutation({
    mutationFn: ({ id, action, job }: { id: string; action: Verb; job?: Job }) => {
      if (action === "retry") return jobsApi.retry(id);
      if (action === "cancel") return jobsApi.cancel(id);
      // One more than it has, rather than a number somebody types: the useful
      // grant is "let it try again", and a spinner asking how many would be a
      // decision nobody has an opinion about.
      return jobsApi.allowAttempts(id, (job?.max_attempts ?? 1) + 1);
    },
    onSuccess: async (job, { action }) => {
      message.success(
        action === "retry"
          ? `${job.reference} is queued again — attempt ${job.attempt} of ${job.max_attempts}.`
          : action === "cancel"
            ? `${job.reference} was stopped.`
            : `${job.reference} may now be tried ${job.max_attempts} times. Retry is available.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    // The server's own sentence, which names the state or the bound. A generic
    // "that failed" would throw away the only useful part.
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That was refused."),
  });

  usePageCommands("admin-jobs", [
    {
      id: "jobs.failed",
      label: "Show the jobs that failed",
      keywords: "jobs failed errors queue retry",
      run: () => set({ status: "FAILED" }),
    },
    {
      id: "jobs.running",
      label: "Show what is running now",
      keywords: "jobs running in progress active current",
      run: () => set({ status: "RUNNING" }),
    },
    {
      id: "jobs.queued",
      label: "Show what is waiting to run",
      keywords: "jobs queued pending backlog waiting",
      run: () => set({ status: "QUEUED" }),
    },
    {
      id: "jobs.all",
      label: "Show every job",
      keywords: "jobs all clear filter everything",
      run: () => set({ status: null }),
    },
    {
      id: "jobs.refresh",
      label: "Check the queue again",
      keywords: "refresh reload poll now",
      run: () => void listing.refetch(),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 10 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="Background jobs" />
        <Alert
          type="error"
          showIcon
          message={
            catalogue.error instanceof ApiError
              ? catalogue.error.message
              : "The queue could not be read."
          }
        />
      </>
    );
  }

  const statuses = catalogue.data!.statuses;
  const canManage = catalogue.data!.can_manage;
  const facets = listing.data?.facets ?? {};
  const rows = listing.data?.items ?? [];
  const running = statuses.find((entry) => entry.key === "RUNNING")?.count ?? 0;

  const columns: ColumnsType<Job> = [
    {
      title: "Job",
      dataIndex: "name",
      render: (name: string, row) => (
        <div className="nu-job-what">
          <Text strong className="nu-job-name">
            {name}
          </Text>
          <Text type="secondary" className="nu-job-ref">
            {row.reference} · {row.kind.toLowerCase()} · {row.queue}
          </Text>
        </div>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 132,
      render: (value: JobStatus, row) => (
        <Space size={4} direction="vertical" className="nu-job-status">
          {/* Written out as well as coloured (§64). */}
          <Tag color={toneFor(value)} bordered={false}>
            {value.toLowerCase()}
          </Tag>
          {/* "Failed" and "failed three times" are different problems, and a
              queue showing only the latest status hides the second. */}
          {row.attempt > 1 && (
            <Text type="secondary" className="nu-job-attempt">
              attempt {row.attempt} of {row.max_attempts}
            </Text>
          )}
        </Space>
      ),
    },
    {
      title: "Progress",
      dataIndex: "progress",
      width: 196,
      render: (_value: number, row) => (
        <div className="nu-job-progress">
          <Progress
            percent={row.progress}
            size="small"
            showInfo={false}
            // Deliberately not `status="active"` for a running job: AntD's
            // active bar animates *forever*, so the page never goes idle —
            // which costs a laptop battery on a screen somebody leaves open,
            // and made every wait-for-animations assertion here time out. The
            // shimmer carried nothing anyway: this bar is `aria-hidden`
            // decoration, and "running" is already said by the status tag and
            // by the units beside it.
            status={
              row.status === "FAILED"
                ? "exception"
                : row.status === "SUCCEEDED"
                  ? "success"
                  : "normal"
            }
            // The bar is decoration over a number that is already readable:
            // a percentage nobody can read out is not progress (§64).
            aria-hidden="true"
          />
          <Text type="secondary" className="nu-job-units">
            {progressLabel(row)}
          </Text>
        </div>
      ),
    },
    {
      title: "When",
      dataIndex: "created_at",
      width: 150,
      render: (value: string | null, row) => (
        <Tooltip title={value ? absoluteTime(value) : undefined}>
          <Text type="secondary" className="nu-job-when">
            {value ? relativeTime(value) : "—"}
            {row.duration_ms !== null && (
              <>
                <br />
                took {formatDuration(row.duration_ms)}
              </>
            )}
          </Text>
        </Tooltip>
      ),
    },
    ...(canManage
      ? [
          {
            title: "",
            key: "act",
            width: 96,
            align: "right" as const,
            render: (_value: unknown, row: Job) => (
              <Space size={2}>
                <JobAction
                  job={row}
                  action="retry"
                  icon={<RedoOutlined />}
                  busy={act.isPending}
                  onConfirm={() => act.mutate({ id: row.id, action: "retry" })}
                />
                <JobAction
                  job={row}
                  action="cancel"
                  icon={<StopOutlined />}
                  busy={act.isPending}
                  onConfirm={() => act.mutate({ id: row.id, action: "cancel" })}
                />
                {/* Only where the server says it would change something —
                    which is exactly where the retry refusal points at it. */}
                {row.can_allow_attempts && (
                  <Tooltip title={`Allow ${row.max_attempts + 1} attempts, so it can run again`}>
                    <Button
                      type="text"
                      icon={<PlusOutlined />}
                      disabled={act.isPending}
                      aria-label={`Grant ${row.reference} another attempt`}
                      data-testid={`grant-${row.reference}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        act.mutate({ id: row.id, action: "grant", job: row });
                      }}
                    />
                  </Tooltip>
                )}
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="nu-fill">
      <PageHeader
        title="Background jobs"
        subtitle="What the platform has run, what failed, and what can be tried again."
        tag={
          running > 0 ? (
            <Tag color="processing">{running} running</Tag>
          ) : (
            <Tag>nothing running</Tag>
          )
        }
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder="Name, reference, or an error"
              aria-label="Search the queue"
              style={{ width: 250 }}
              value={box}
              onChange={(event) => setBox(event.target.value)}
            />
            <Select
              aria-label="Queue"
              value={queue || "all"}
              style={{ width: 150 }}
              onChange={(next) => set({ queue: next === "all" ? null : next })}
              options={[
                { value: "all", label: "Every queue" },
                ...(facets["queue"] ?? []).map((item) => ({
                  value: item.value,
                  label: `${item.value} (${item.count})`,
                })),
              ]}
            />
            <AutoRefresh
              page="jobs"
              defaultSeconds={30}
              updatedAt={listing.dataUpdatedAt}
              busy={listing.isFetching}
              refresh={() => void listing.refetch()}
            />
          </Space>
        }
      />

      {/* Counts the whole queue, not the page: clicking a status narrows the
          table and leaves these alone (§71). */}
      <div className="nu-kindstrip nu-kindstrip--fill" data-testid="job-statuses">
        <button
          type="button"
          className={`nu-kindchip${status === "" ? " is-active" : ""}`}
          aria-pressed={status === ""}
          onClick={() => set({ status: null })}
        >
          <span className="nu-kindchip-count">{catalogue.data!.total.toLocaleString()}</span>
          <span className="nu-kindchip-label">Everything</span>
        </button>
        {statuses.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`nu-kindchip${status === entry.key ? " is-active" : ""}${
              entry.count === 0 ? " is-empty" : ""
            }`}
            aria-pressed={status === entry.key}
            // Offered at nought and refused, so the reader learns the status
            // exists and that nothing is in it (§76).
            disabled={entry.count === 0}
            onClick={() => set({ status: entry.key })}
            data-testid={`job-status-${entry.key}`}
          >
            <span className="nu-kindchip-count">{entry.count.toLocaleString()}</span>
            <span className="nu-kindchip-label">{entry.key.toLowerCase()}</span>
          </button>
        ))}
      </div>

      {!canManage && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          data-testid="read-only"
          message="You can watch the queue but not change it."
          description="Retrying a job re-runs real work against real records, so it needs `jobs.manage`."
        />
      )}

      <div className="nu-pane nu-pane--table nu-job">
        <Table<Job>
          size="small"
          rowKey="id"
          data-testid="jobs-table"
          columns={columns}
          dataSource={rows}
          loading={listing.isLoading}
          onRow={(row) => ({
            onClick: () => setOpened(row.id),
            style: { cursor: "pointer" },
          })}
          locale={{
            emptyText: (
              <EmptyState compact title={
                  term || status || queue
                    ? "No job matches that."
                    : "Nothing has been queued yet."
                } />
            ),
          }}
          pagination={{
            current: listing.data?.page ?? 1,
            pageSize: listing.data?.page_size ?? 25,
            total: listing.data?.total ?? 0,
            showSizeChanger: false,
            onChange: (next) => set({ page: String(next) }),
            showTotal: (total) => `${total.toLocaleString()} jobs`,
          }}
        />
      </div>

      <Drawer
        open={opened !== null}
        onClose={() => setOpened(null)}
        width={620}
        title="One job"
        destroyOnClose
      >
        {detail.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
        {detail.isError && (
          <Alert
            type="error"
            showIcon
            message={
              detail.error instanceof ApiError
                ? detail.error.message
                : "That job could not be read."
            }
          />
        )}
        {detail.data && (
          <JobDetailPane
            job={detail.data}
            canManage={canManage}
            busy={act.isPending}
            onAct={(action) => act.mutate({ id: detail.data.id, action, job: detail.data })}
          />
        )}
      </Drawer>
    </div>
  );
}

/**
 * One control, disabled with its reason rather than hidden.
 *
 * The reason comes from `whyNot`, so the tooltip always says something an
 * operator can act on — "not while it is running" and "all three attempts have
 * been used" are different problems with different fixes, and a shared "not
 * allowed" would have told them neither.
 */
function JobAction({
  job,
  action,
  icon,
  busy,
  onConfirm,
}: {
  job: Job;
  action: "retry" | "cancel";
  icon: React.ReactNode;
  busy: boolean;
  onConfirm: () => void;
}) {
  const reason = whyNot(job, action);
  const label = action === "retry" ? "Retry" : "Cancel";
  // What the *confirmation* button says, which is not the same word as the
  // control. AntD's Popconfirm dismisses itself with a button labelled
  // "Cancel", so an action also called "Cancel" produced a dialog offering
  // "Cancel" and "Cancel" — found by a test that could not tell them apart,
  // which is exactly the trouble a reader would have had.
  const confirmLabel = action === "retry" ? "Retry" : "Stop the job";
  const allowed = reason === null;

  const button = (
    <Button
      type="text"
      icon={icon}
      disabled={!allowed || busy}
      aria-label={`${label} ${job.reference}`}
      data-testid={`${action}-${job.reference}`}
      onClick={(event) => event.stopPropagation()}
    />
  );

  // The tooltip belongs to the *disabled* case and only to it. That is where
  // it carries information — which of the two refusals this is — and the
  // enabled path already says the same word three times over: the button's
  // own accessible name, the confirmation's title, and its Ok label. Worse
  // than redundant, in fact: a Tooltip nested inside a Popconfirm renders a
  // second popover over the first, and the hint ended up covering the button
  // it was describing, which is how this was found.
  if (!allowed) {
    return <Tooltip title={reason}>{button}</Tooltip>;
  }

  return (
    <Popconfirm
      title={action === "retry" ? `Run ${job.reference} again?` : `Stop ${job.reference}?`}
      description={
        action === "retry"
          ? `This will be attempt ${job.attempt + 1} of ${job.max_attempts}, on the same job.`
          : "The job stays in the queue, marked cancelled."
      }
      okText={confirmLabel}
      onConfirm={onConfirm}
      onPopupClick={(event) => event.stopPropagation()}
    >
      {button}
    </Popconfirm>
  );
}

/** Milliseconds, in the largest unit that keeps it readable. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

/**
 * One job in full.
 *
 * Ordered the way somebody investigates: what it was asked to do, how it went,
 * what it said, and then the controls — so a Retry is the last thing reached
 * rather than the first thing clicked.
 */
function JobDetailPane({
  job,
  canManage,
  busy,
  onAct,
}: {
  job: JobDetail;
  canManage: boolean;
  busy: boolean;
  onAct: (action: Verb) => void;
}) {
  return (
    <Space direction="vertical" size={16} className="nu-block">
      <div>
        <Space size={8}>
          <Tag color={toneFor(job.status)} bordered={false}>
            {job.status.toLowerCase()}
          </Tag>
          <Tag bordered={false}>
            attempt {job.attempt} of {job.max_attempts}
          </Tag>
          {job.duration_ms !== null && (
            <Tag bordered={false}>{formatDuration(job.duration_ms)}</Tag>
          )}
        </Space>
        <p className="nu-job-detail-name">{job.name}</p>
        <Text type="secondary">{progressLabel(job)}</Text>
      </div>

      {job.error_message && (
        <Alert
          type={job.status === "RETRYING" ? "warning" : "error"}
          showIcon
          data-testid="job-error"
          message={job.status === "RETRYING" ? "Failed, and will be tried again" : "It failed"}
          description={job.error_message}
        />
      )}

      <Descriptions
        size="small"
        column={1}
        bordered
        items={[
          { key: "ref", label: "Reference", children: <Text copyable className="nu-mono">{job.reference}</Text> },
          { key: "kind", label: "Kind", children: job.kind.toLowerCase() },
          { key: "queue", label: "Queue", children: job.queue },
          { key: "priority", label: "Priority", children: job.priority.toLowerCase() },
          { key: "by", label: "Started by", children: job.initiated_by_label ?? "System" },
          {
            key: "queued",
            label: "Queued",
            children: job.created_at ? absoluteTime(job.created_at) : "—",
          },
          {
            key: "started",
            label: "Started",
            children: job.started_at ? absoluteTime(job.started_at) : "not yet",
          },
          {
            key: "finished",
            label: "Finished",
            children: job.finished_at ? absoluteTime(job.finished_at) : "not yet",
          },
        ]}
      />

      {Object.keys(job.payload).length > 0 && (
        <div>
          <Text strong>What it was asked to do</Text>
          <pre className="nu-log-block" data-testid="job-payload">
            {JSON.stringify(job.payload, null, 2)}
          </pre>
        </div>
      )}

      {job.result && (
        <div>
          <Text strong>What it produced</Text>
          <pre className="nu-log-block" data-testid="job-result">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </div>
      )}

      {job.log_lines.length > 0 && (
        <div>
          <Text strong>Its own log</Text>
          {job.log_truncated && (
            <Text type="secondary" className="nu-job-truncated">
              {" "}
              — the first {job.log_lines.length}; the rest are in the system log
            </Text>
          )}
          <ul className="nu-job-lines" data-testid="job-lines">
            {job.log_lines.map((line, index) => (
              <li key={`${line.at ?? index}-${index}`}>
                <Text type={line.level === "ERROR" ? "danger" : "secondary"}>
                  {line.level.toLowerCase()}
                </Text>{" "}
                <span>{line.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canManage && (
        <Space size={8}>
          <Tooltip title={whyNot(job, "retry") ?? "Run it again, as the next attempt"}>
            <Button
              icon={<RedoOutlined />}
              disabled={!job.can_retry || busy}
              onClick={() => onAct("retry")}
              data-testid="detail-retry"
            >
              Retry
            </Button>
          </Tooltip>
          <Tooltip title={whyNot(job, "cancel") ?? "Stop it, keeping the row"}>
            <Button
              danger
              icon={<StopOutlined />}
              disabled={!job.can_cancel || busy}
              onClick={() => onAct("cancel")}
              data-testid="detail-cancel"
            >
              Cancel
            </Button>
          </Tooltip>
          {job.can_allow_attempts && (
            <Button
              icon={<PlusOutlined />}
              disabled={busy}
              onClick={() => onAct("grant")}
              data-testid="detail-grant"
            >
              Allow {job.max_attempts + 1} attempts
            </Button>
          )}
        </Space>
      )}
    </Space>
  );
}
