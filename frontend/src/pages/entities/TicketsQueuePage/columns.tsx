import { Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import { humanStatus, StatusTag } from "@/components/StatusTag";
import { RecordActions, type RecordEditing } from "@/components/records/useRecordEditing";
import { duration, slaStanding, type SlaStanding } from "@/entities/sla";
import { absoluteTime, relativeTime } from "@/lib/time";

import type { TicketRow } from "./types";

const { Text } = Typography;

/** How an SLA standing reads in a column, where there is room for two words. */
const SLA_TONE: Record<SlaStanding["tone"], string | undefined> = {
  danger: "error",
  warning: "warning",
  success: "success",
  info: undefined,
};

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

/** The queue's columns, read as a triage pass reads: subject, severity, then the clock. */
export function ticketColumns(records: RecordEditing): ColumnsType<TicketRow> {
  return [
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
    {
      title: "Category",
      dataIndex: "category",
      width: 132,
      sorter: true,
      render: (value: string | null) => (value ? humanStatus(value) : "—"),
    },
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
}
