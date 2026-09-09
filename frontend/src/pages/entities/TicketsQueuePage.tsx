/**
 * Tickets as a table (§7, §62, §63).
 *
 * This page was a split view: the queue on the left, a *preview* of the chosen
 * ticket on the right, and "Full record" from there to the console. Two things
 * were wrong with it. The preview was a second rendering of a record that
 * already has a page — the same description, the same tags, the same history,
 * maintained twice and slightly differently — and the queue itself was a list
 * of coloured chips in a 380-pixel column, which is the one shape that cannot
 * answer "which of these forty is worst".
 *
 * So the queue is a table and the console is the console. A row is a line a
 * reader scans down: severity in one column, the clock in another, and the
 * subject wide enough to read. Clicking it opens `/tickets/:id`, which is
 * where the work is done.
 *
 * **The SLA column is the point of the page**, and it is derived rather than
 * printed: `entities/sla.ts` turns four timestamps into "Breached 3d ago" or
 * "Due in 5h", which is the fact somebody triages on. Whether the promise was
 * *missed* is still the server's answer (`sla_breached`) — a page that decided
 * that for itself would disagree with every report ever run (§71).
 */

import { Card, Segmented, Skeleton, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType, TablePaginationConfig } from "antd/es/table";
import type { SorterResult } from "antd/es/table/interface";
import { useNavigate } from "react-router-dom";

import { StatusTag } from "@/components/StatusTag";
import {
  NewRecordButton,
  RecordActions,
  useRecordEditing,
} from "@/components/records/useRecordEditing";
import { opensRecord, useBulk } from "@/components/records/useBulk";
import { usePageCommands } from "@/commands/CommandContext";
import { duration, slaStanding, type SlaStanding } from "@/entities/sla";
import {
  EntityEmpty,
  EntityError,
  EntityFilters,
  EntityHeader,
  MetricStrip,
} from "@/entities/EntityChrome";
import { useEntityView } from "@/entities/useEntityView";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

/**
 * `first_response_at`, `resolved_at` and `resolution_minutes` are asked for
 * although no column prints them: the SLA rule needs them to say whether a
 * ticket was answered, resolved, or resolved *late*.
 */
const COLUMNS = [
  "reference", "subject", "status", "priority", "severity",
  "category", "channel", "due_at", "sla_breached",
  "first_response_at", "resolved_at", "resolution_minutes", "created_at",
];

interface TicketRow {
  id: string;
  reference?: string;
  subject?: string;
  status?: string;
  priority?: string;
  severity?: string;
  category?: string;
  channel?: string;
  due_at?: string | null;
  sla_breached?: boolean;
  first_response_at?: string | null;
  resolved_at?: string | null;
  resolution_minutes?: number | null;
  created_at?: string | null;
}

/** How an SLA standing reads in a column, where there is room for two words. */
const SLA_TONE: Record<SlaStanding["tone"], string | undefined> = {
  danger: "error",
  warning: "warning",
  success: "success",
  info: undefined,
};

export default function TicketsQueuePage() {
  const navigate = useNavigate();
  const view = useEntityView("ticket", {
    columns: COLUMNS,
    defaultSort: "severity",
    defaultOrder: "asc",
  });

  const rows = (view.rows.data?.items ?? []) as TicketRow[];
  const records = useRecordEditing(view.resource, {
    onCreated: (id) => navigate(`/tickets/${id}`),
  });
  // The list's own request is what "everything matching this filter" means,
  // sent unchanged — a hand-built copy of the filters would be a second
  // question, and rows nobody saw would change the first time the two differed.
  const bulk = useBulk(view.resource, {
    request: view.request,
    total: view.rows.data?.total ?? 0,
  });

  usePageCommands("entity:ticket", [
    {
      id: "ticket.new",
      label: "Raise a ticket",
      keywords: "new add create report",
      run: records.create,
    },
    {
      id: "ticket.breached",
      label: "Show tickets that have breached their SLA",
      keywords: "sla late overdue",
      run: () => view.setFilter("sla_breached", "true"),
    },
    {
      id: "ticket.critical",
      label: "Show critical tickets",
      keywords: "severity urgent",
      run: () => view.setFilter("severity", "CRITICAL"),
    },
  ]);

  /** Where this ticket stands against its clock. */
  const standingFor = (row: TicketRow) =>
    slaStanding({
      createdAt: row.created_at ?? null,
      dueAt: row.due_at ?? null,
      firstResponseAt: row.first_response_at ?? null,
      resolvedAt: row.resolved_at ?? null,
      resolutionMinutes: row.resolution_minutes ?? null,
      breached: Boolean(row.sla_breached),
    });

  const columns: ColumnsType<TicketRow> = [
    {
      title: "Reference",
      dataIndex: "reference",
      width: 112,
      fixed: "left",
      sorter: true,
      render: (value: string) => <Text className="nu-mono">{value}</Text>,
    },
    {
      title: "Subject",
      dataIndex: "subject",
      ellipsis: true,
      sorter: true,
      // The widest column by design. Severity and the clock decide the order a
      // reader works in; the subject is what they are deciding *about*, and
      // "Order stuck in fulfilme…" is a row nobody can triage.
      // No breach marker here: the service-level column says it in words, and
      // an icon repeating it on 84% of the rows is a decoration.
      render: (value: string) => (
        <Text strong ellipsis={{ tooltip: value }}>
          {value}
        </Text>
      ),
    },
    {
      // First after the subject, because severity is what a triage pass reads.
      title: "Severity",
      dataIndex: "severity",
      width: 116,
      sorter: true,
      defaultSortOrder: "ascend",
      render: (value: string) => (
        <StatusTag status={value} bordered={false} />
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 148,
      sorter: true,
      render: (value: string) => (
        <StatusTag status={value} bordered={false} />
      ),
    },
    {
      // The reason the page is open: a deadline, read as time rather than as a
      // timestamp somebody has to subtract from today.
      title: "Service level",
      key: "sla",
      width: 152,
      render: (_value: unknown, row) => {
        const standing = standingFor(row);
        return (
          <Tooltip title={standing.detail}>
            <span className="nu-sla-cell">
              <Tag color={SLA_TONE[standing.tone]} bordered={false}>
                {standing.headline}
              </Tag>
              {standing.minutesLeft !== null && !row.resolved_at && (
                <Text type="secondary" className="nu-sla-clock">
                  {standing.minutesLeft < 0
                    ? `${duration(Math.abs(standing.minutesLeft))} ago`
                    : `in ${duration(standing.minutesLeft)}`}
                </Text>
              )}
            </span>
          </Tooltip>
        );
      },
    },
    { title: "Category", dataIndex: "category", width: 132, sorter: true },
    {
      title: "Raised",
      dataIndex: "created_at",
      width: 116,
      sorter: true,
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <Text>{relativeTime(value)}</Text>
        </Tooltip>
      ),
    },
    {
      title: "",
      key: "actions",
      width: 48,
      fixed: "right",
      render: (_value: unknown, row) => (
        <RecordActions
          records={records}
          id={row.id}
          label={row.reference ?? row.subject ?? "this ticket"}
        />
      ),
    },
  ];

  const onChange = (
    pagination: TablePaginationConfig,
    _filters: unknown,
    sorter: SorterResult<TicketRow> | SorterResult<TicketRow>[],
  ) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    const field = typeof single?.field === "string" ? single.field : view.sort;
    view.set({
      page: pagination.current === 1 ? null : (pagination.current ?? null),
      page_size: pagination.pageSize === 25 ? null : (pagination.pageSize ?? null),
      sort: single?.order ? field : null,
      order: single?.order === "ascend" ? "asc" : null,
    });
  };

  if (view.catalogue.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <>
      <EntityHeader
        view={view}
        subtitle="The queue, worst first — severity, the clock, and what it is about, on one line each."
        actions={<NewRecordButton records={records} resource={view.resource} />}
      />

      <MetricStrip view={view} accents={["accent", "info", "danger", "neutral"]} />

      <EntityFilters view={view} only={["severity", "status", "category", "channel", "priority"]}>
        {/* The one filter worth a control of its own: it is the reason the
            page is open, and burying it in a select makes it a search. */}
        <Segmented
          aria-label="SLA"
          data-testid="sla-filter"
          value={view.filters["sla_breached"] ?? "all"}
          onChange={(next) =>
            view.setFilter("sla_breached", next === "all" ? null : String(next))
          }
          options={[
            { label: "Any SLA", value: "all" },
            { label: "Breached", value: "true" },
            { label: "Within SLA", value: "false" },
          ]}
        />
      </EntityFilters>

      <EntityError view={view} />

      <Card size="small" className="nu-block" data-testid="ticket-queue">
        {/* Above the table, not floating over it: a bar that covers the last
            row hides part of what the reader is deciding about (§43). */}
        {bulk.bar}
        <Table<TicketRow>
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          rowSelection={bulk.rowSelection}
          loading={view.rows.isLoading}
          onChange={onChange}
          scroll={{ x: 940 }}
          onRow={(row) => ({
            // Not when the click was on a control — a tick box opens nothing.
            onClick: (event) => {
              if (opensRecord(event.target)) navigate(`/tickets/${row.id}`);
            },
            style: { cursor: "pointer" },
          })}
          locale={{
            emptyText: (
              <EntityEmpty
                view={view}
                title="Nothing has been raised"
                hint="A ticket is a customer's problem with a deadline attached."
                action={<NewRecordButton records={records} resource={view.resource} />}
              />
            ),
          }}
          pagination={{
            current: view.rows.data?.page ?? view.page,
            pageSize: view.rows.data?.page_size ?? view.pageSize,
            total: view.rows.data?.total ?? 0,
            showSizeChanger: true,
            pageSizeOptions: [25, 50, 100],
            showTotal: (count, range) => `${range[0]}–${range[1]} of ${count.toLocaleString()}`,
          }}
        />
      </Card>

      {records.drawer}
      {bulk.dialog}
    </>
  );
}
