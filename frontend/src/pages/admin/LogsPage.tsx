/**
 * `/admin/logs` — what the platform has been doing, and why (§22).
 *
 * Five decisions worth stating.
 *
 * **The level strip is a severity floor, not a set of toggles.** Clicking
 * WARNING means "warnings and worse", because that is what somebody clicking
 * it wants: they are looking for trouble and an ERROR hidden behind the filter
 * chosen to find it is the worst thing a log viewer can do. The server owns the
 * ranking, so this page never has to know it. Every level is offered even at
 * nought — a chip that appears only once something breaks is a chip people
 * learn to stop looking for (§76).
 *
 * **One search box, and it searches the ids too.** Paste the correlation id
 * from an error screen and the request is there. That is the whole reason the
 * column exists, and making somebody choose a field first would hide it behind
 * a decision they cannot make until they know the answer.
 *
 * **Live is a poll the reader controls.** Pause stops asking; resume asks from
 * the cursor it stopped at, so nothing is missed and nothing is repeated.
 * Deliberately not a socket: see `api/logs.ts`. The tail respects the filters
 * beside it, because a pause that changed what you were looking at would be
 * worse than no pause.
 *
 * **A log line is one line.** Monospace, fixed columns, no wrapping — this is a
 * page somebody scans two hundred rows of, and a table whose rows change height
 * with the length of a message cannot be scanned at all. The message is clipped
 * and the full text is in the pane.
 *
 * **The detail pane carries the whole request, not just the line.** The context,
 * the stack trace, and the sibling lines sharing the correlation id: one failure
 * is rarely one line, and reading "permission denied" without the request that
 * caused it is reading half the story.
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
  Select,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { logsApi, type LogLevel, type LogLine } from "@/api/logs";
import { useAuth } from "@/auth/AuthProvider";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { absoluteTime, relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

/** How often the tail asks, while it is running. */
const POLL_MS = 4000;

/**
 * The colour a level is drawn in.
 *
 * Never the only carrier of the meaning (§64): the level is spelled out in the
 * cell beside it, so this is emphasis rather than information — which is what
 * lets a reader with no colour vision use the same table.
 */
export function toneFor(level: LogLevel): string | undefined {
  switch (level) {
    case "CRITICAL":
    case "ERROR":
      return "error";
    case "WARNING":
      return "warning";
    case "DEBUG":
      return undefined;
    default:
      return "success";
  }
}

/**
 * What a duration deserves to be called.
 *
 * Exported and asserted directly: the boundary between "fine" and "slow" is a
 * judgement, and a reader scanning a column of numbers needs the outliers to
 * announce themselves rather than being asked to compare 1,847 with 194.
 */
export function paceOf(ms: number | null): "quick" | "fine" | "slow" | "unknown" {
  if (ms === null) return "unknown";
  if (ms >= 1000) return "slow";
  if (ms >= 200) return "fine";
  return "quick";
}

export default function LogsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message } = AntApp.useApp();
  const { profile } = useAuth();

  const [box, setBox] = useState(params.get("q") ?? "");
  const term = useDebouncedValue(box, 250);
  const minLevel = (params.get("min_level") ?? "") as LogLevel | "";
  const service = params.get("service") ?? "";
  const environment = params.get("environment") ?? "";
  const page = Number(params.get("page") ?? 1);

  const [opened, setOpened] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  // The tail's own rows, newest first, kept outside react-query: they are an
  // append-only stream rather than the answer to a question, and putting them
  // in the cache would make every poll a re-render of the whole page.
  const [streamed, setStreamed] = useState<LogLine[]>([]);
  const cursor = useRef<string | null>(null);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === "") next.delete(key);
          else next.set(key, value);
        }
        // Any change of question starts at the first page: page 3 of a
        // different filter is a page nobody asked for.
        if (!("page" in changes)) next.delete("page");
        return next;
      },
      { replace: true },
    );

  const filters = {
    ...(term ? { q: term } : {}),
    ...(minLevel ? { min_level: minLevel } : {}),
    ...(service ? { service } : {}),
    ...(environment ? { environment } : {}),
  };

  // The address follows the *settled* value, so a reload restores the question
  // rather than a half-typed one — and typing does not push forty history
  // entries (§69).
  useEffect(() => {
    set({ q: term || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  const catalogue = useQuery({
    queryKey: ["logs", "catalogue"],
    queryFn: ({ signal }) => logsApi.catalogue(signal),
    staleTime: 60_000,
  });

  const listing = useQuery({
    queryKey: ["logs", "list", filters, page],
    queryFn: ({ signal }) => logsApi.list({ ...filters, page, page_size: 50 }, signal),
    // While the tail is running the table is the stream, so the paged read is
    // not refetched underneath it.
    enabled: !live,
  });

  const detail = useQuery({
    queryKey: ["logs", "entry", opened],
    queryFn: ({ signal }) => logsApi.entry(opened!, signal),
    enabled: opened !== null,
  });

  const prune = useMutation({
    mutationFn: () => logsApi.prune(),
    onSuccess: async (result) => {
      message.success(
        result.removed === 0
          ? `Nothing was older than ${result.retention_days} days.`
          : `${result.removed.toLocaleString()} lines older than ${result.retention_days} days removed.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["logs"] });
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That was refused."),
  });

  /** One poll. Separate so both the interval and Resume can call it. */
  const poll = useCallback(async () => {
    try {
      const answer = await logsApi.tail({
        ...filters,
        ...(cursor.current ? { after: cursor.current } : {}),
      });
      cursor.current = answer.cursor;
      if (answer.items.length > 0) {
        // The server sends oldest-first so a client appends; this table is
        // newest-first, so they go on the front reversed.
        setStreamed((current) => [...[...answer.items].reverse(), ...current].slice(0, 500));
      }
    } catch (error) {
      // A failed poll stops the tail rather than retrying forever: a viewer
      // that silently kept failing would look like a quiet system.
      setLive(false);
      message.error(
        error instanceof ApiError ? error.message : "The tail stopped — it could not be read.",
      );
    }
    // `filters` is rebuilt each render; the fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, minLevel, service, environment, message]);

  useEffect(() => {
    if (!live) return;
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [live, poll]);

  // Changing the question while live restarts the stream: keeping rows that no
  // longer match the filter would be a table showing what it says it is not.
  useEffect(() => {
    if (live) {
      cursor.current = null;
      setStreamed([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term, minLevel, service, environment]);

  usePageCommands("admin-logs", [
    {
      id: "logs.errors",
      label: "Show errors and worse",
      keywords: "logs errors critical failures",
      run: () => set({ min_level: "ERROR" }),
    },
    {
      id: "logs.live",
      label: "Follow the log live",
      keywords: "logs tail follow live stream",
      run: () => setLive(true),
    },
  ]);

  if (catalogue.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (catalogue.isError) {
    return (
      <>
        <PageHeader title="System logs" />
        <Alert
          type="error"
          showIcon
          message={
            catalogue.error instanceof ApiError
              ? catalogue.error.message
              : "The log could not be read."
          }
        />
      </>
    );
  }

  const levels = catalogue.data!.levels;
  const retention = catalogue.data!.retention_days;
  const facets = listing.data?.facets ?? {};
  const rows = live ? streamed : (listing.data?.items ?? []);
  const canPrune = profile?.permissions.includes("settings.manage") ?? false;

  const columns: ColumnsType<LogLine> = [
    {
      title: "When",
      dataIndex: "logged_at",
      width: 148,
      render: (value: string | null) =>
        value ? (
          <Tooltip title={absoluteTime(value)}>
            <Text type="secondary" className="nu-log-when">
              {relativeTime(value)}
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "Level",
      dataIndex: "level",
      width: 96,
      render: (level: LogLevel) => (
        // Spelled out as well as coloured (§64).
        <Tag color={toneFor(level)} bordered={false} className="nu-log-level">
          {level.toLowerCase()}
        </Tag>
      ),
    },
    {
      title: "Source",
      dataIndex: "logger",
      width: 190,
      render: (logger: string | null, row) => (
        <Text type="secondary" className="nu-log-source" title={`${row.service} · ${logger ?? ""}`}>
          {logger ?? row.service}
        </Text>
      ),
    },
    {
      title: "Message",
      dataIndex: "message",
      // One line, clipped: a table whose row height follows the length of a
      // message cannot be scanned, and scanning is what this page is for.
      render: (value: string) => <span className="nu-log-message">{value}</span>,
    },
    {
      title: "Took",
      dataIndex: "duration_ms",
      width: 92,
      align: "right",
      render: (value: number | null) =>
        value === null ? (
          <Text type="secondary">—</Text>
        ) : (
          <Text
            type={paceOf(value) === "slow" ? "warning" : "secondary"}
            className="nu-log-took"
          >
            {Math.round(value).toLocaleString()} ms
          </Text>
        ),
    },
  ];

  return (
    <div className="nu-fill">
      <PageHeader
        title="System logs"
        subtitle="What the platform has been doing. Every request it serves is here, under the correlation id its response carried."
        tag={
          retention === null ? (
            <Tag>no retention policy</Tag>
          ) : (
            <Tooltip title="From `retention.log_days` in the system settings.">
              <Tag>kept {retention} days</Tag>
            </Tooltip>
          )
        }
        actions={
          <Space size={8}>
            <Input.Search
              allowClear
              placeholder="Message, source, or a correlation id"
              aria-label="Search the log"
              style={{ width: 280 }}
              value={box}
              onChange={(event) => setBox(event.target.value)}
            />
            <Select
              aria-label="Service"
              value={service || "all"}
              style={{ width: 150 }}
              onChange={(next) => set({ service: next === "all" ? null : next })}
              options={[
                { value: "all", label: "Every service" },
                ...(facets["service"] ?? []).map((item) => ({
                  value: item.value,
                  label: `${item.value} (${item.count})`,
                })),
              ]}
            />
            <Tooltip
              title={
                live
                  ? "Stop asking for new lines. Resuming carries on from here."
                  : "Ask for new lines every few seconds."
              }
            >
              <Button
                icon={live ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                type={live ? "primary" : "default"}
                onClick={() => setLive((current) => !current)}
                data-testid="toggle-live"
              >
                {live ? "Pause" : "Live"}
              </Button>
            </Tooltip>
            {!live && (
              <Tooltip title="Read it again">
                <Button
                  icon={<ReloadOutlined />}
                  aria-label="Refresh the log"
                  loading={listing.isFetching}
                  onClick={() => void listing.refetch()}
                />
              </Tooltip>
            )}
            {/* Absent rather than disabled for a reader who may not enact the
                policy — the button belongs to whoever owns the bound (§76). */}
            {canPrune && retention !== null && (
              <Popconfirm
                title={`Remove lines older than ${retention} days?`}
                description="The bound is the retention setting, not a choice made here."
                okText="Apply the policy"
                onConfirm={() => prune.mutate()}
              >
                <Button
                  icon={<DeleteOutlined />}
                  loading={prune.isPending}
                  data-testid="prune-logs"
                >
                  Apply retention
                </Button>
              </Popconfirm>
            )}
          </Space>
        }
      />

      {/* A severity floor, not a set of toggles — see the module docstring. */}
      <div className="nu-kindstrip nu-kindstrip--fill" data-testid="log-levels">
        <button
          type="button"
          className={`nu-kindchip${minLevel === "" ? " is-active" : ""}`}
          aria-pressed={minLevel === ""}
          onClick={() => set({ min_level: null })}
        >
          <span className="nu-kindchip-count">
            {catalogue.data!.total.toLocaleString()}
          </span>
          <span className="nu-kindchip-label">Everything</span>
        </button>
        {levels.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`nu-kindchip${minLevel === entry.key ? " is-active" : ""}`}
            aria-pressed={minLevel === entry.key}
            onClick={() => set({ min_level: entry.key })}
            data-testid={`log-level-${entry.key}`}
          >
            <span className="nu-kindchip-count">{entry.count.toLocaleString()}</span>
            <span className="nu-kindchip-label">
              {entry.key.toLowerCase()}
              {/* Said on the chip, because "and worse" is the whole
                  behaviour and a filter that quietly did more than its
                  label would be a filter nobody trusts. */}
              {entry.key !== "CRITICAL" && <span className="nu-kindchip-more"> and worse</span>}
            </span>
          </button>
        ))}
      </div>

      {live && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          icon={<PlayCircleOutlined />}
          data-testid="live-banner"
          message={
            streamed.length === 0
              ? "Following the log. Nothing new yet — every request the platform serves will appear here."
              : `Following the log — ${streamed.length.toLocaleString()} ${streamed.length === 1 ? "line" : "lines"} since you started.`
          }
        />
      )}

      <div className="nu-pane nu-pane--table nu-log">
        <Table<LogLine>
          size="small"
          rowKey="id"
          data-testid="log-table"
          columns={columns}
          dataSource={rows}
          loading={!live && listing.isLoading}
          onRow={(row) => ({
            onClick: () => setOpened(row.id),
            style: { cursor: "pointer" },
          })}
          rowClassName={(row) => `nu-log-row is-${row.level.toLowerCase()}`}
          locale={{
            emptyText: (
              <EmptyState compact title={
                  term || minLevel || service
                    ? "No line matches that."
                    : "Nothing has been logged yet."
                } />
            ),
          }}
          pagination={
            live
              ? false
              : {
                  current: listing.data?.page ?? 1,
                  pageSize: listing.data?.page_size ?? 50,
                  total: listing.data?.total ?? 0,
                  showSizeChanger: false,
                  onChange: (next) => set({ page: String(next) }),
                  showTotal: (total) => `${total.toLocaleString()} lines`,
                }
          }
        />
      </div>

      <Drawer
        open={opened !== null}
        onClose={() => setOpened(null)}
        width={620}
        title="One log line"
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
                : "That line could not be read."
            }
          />
        )}
        {detail.data && <LineDetail entry={detail.data} onOpen={setOpened} />}
      </Drawer>
    </div>
  );
}

/**
 * One line in full.
 *
 * The order is the order somebody investigates in: what happened, then which
 * request it belonged to, then the machine detail, then the other lines from
 * the same request — which is usually where the answer is.
 */
function LineDetail({
  entry,
  onOpen,
}: {
  entry: import("@/api/logs").LogEntry;
  onOpen: (id: string) => void;
}) {
  return (
    <Space direction="vertical" size={16} className="nu-block">
      <div>
        <Space size={8}>
          <Tag color={toneFor(entry.level)} bordered={false}>
            {entry.level.toLowerCase()}
          </Tag>
          {entry.status_code !== null && <Tag bordered={false}>HTTP {entry.status_code}</Tag>}
          {entry.duration_ms !== null && (
            <Tag bordered={false} color={paceOf(entry.duration_ms) === "slow" ? "warning" : undefined}>
              {Math.round(entry.duration_ms).toLocaleString()} ms
            </Tag>
          )}
        </Space>
        <p className="nu-log-detail-message">{entry.message}</p>
      </div>

      <Descriptions size="small" column={1} bordered items={[
        {
          key: "when",
          label: "When",
          children: entry.logged_at ? absoluteTime(entry.logged_at) : "—",
        },
        { key: "service", label: "Service", children: entry.service },
        { key: "logger", label: "Source", children: entry.logger ?? "—" },
        { key: "environment", label: "Environment", children: entry.environment },
        {
          key: "correlation",
          label: "Correlation ID",
          children: entry.correlation_id ? (
            // Selectable and monospace: this is a value people copy out of one
            // screen and paste into another.
            <Text copyable className="nu-mono">
              {entry.correlation_id}
            </Text>
          ) : (
            "—"
          ),
        },
        ...(entry.trace_id
          ? [
              {
                key: "trace",
                label: "Trace ID",
                children: (
                  <Text copyable className="nu-mono">
                    {entry.trace_id}
                  </Text>
                ),
              },
            ]
          : []),
        ...(entry.host ? [{ key: "host", label: "Host", children: entry.host }] : []),
      ]} />

      {Object.keys(entry.context).length > 0 && (
        <div>
          <Text strong>Request</Text>
          <pre className="nu-log-block" data-testid="line-context">
            {JSON.stringify(entry.context, null, 2)}
          </pre>
        </div>
      )}

      {entry.stack_trace && (
        <div>
          <Text strong>Stack trace</Text>
          <pre className="nu-log-block nu-log-block--trace" data-testid="line-trace">
            {entry.stack_trace}
          </pre>
        </div>
      )}

      <div>
        <Text strong>
          The rest of this request{" "}
          <Text type="secondary">
            ({entry.related.length} other {entry.related.length === 1 ? "line" : "lines"})
          </Text>
        </Text>
        {entry.related.length === 0 ? (
          <p>
            <Text type="secondary">
              {entry.correlation_id
                ? "Nothing else was logged under this correlation id."
                : "This line carries no correlation id, so it cannot be tied to a request."}
            </Text>
          </p>
        ) : (
          <ul className="nu-log-related" data-testid="line-related">
            {entry.related.map((sibling) => (
              <li key={sibling.id}>
                <button type="button" onClick={() => onOpen(sibling.id)}>
                  <Tag color={toneFor(sibling.level)} bordered={false}>
                    {sibling.level.toLowerCase()}
                  </Tag>
                  <span className="nu-log-related-message">{sibling.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Space>
  );
}
