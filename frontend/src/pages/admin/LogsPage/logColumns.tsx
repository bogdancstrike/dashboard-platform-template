import { Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { LogLevel, LogLine } from "@/api/logs";
import type { RowCard } from "@/components/listing/ResponsiveTable";
import { absoluteTime, relativeTime } from "@/lib/time";

import { paceOf, toneFor } from "./logFormat";

const { Text } = Typography;

export const logColumns: ColumnsType<LogLine> = [
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

/** The same line as a card on a phone. */
export function logCard(row: LogLine): RowCard {
  return {
    title: row.message,
    meta: `${row.service} · ${row.logged_at ? relativeTime(row.logged_at) : "—"}`,
    pill: (
      <Tag color={toneFor(row.level)} bordered={false}>
        {row.level.toLowerCase()}
      </Tag>
    ),
  };
}
