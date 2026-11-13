import { Space, Switch, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";

import type { SecurityEvent, SignIn } from "@/api/security";
import { absoluteTime, relativeTime } from "@/lib/time";

import { severityTone } from "./securityCopy";

const { Text } = Typography;

/** Who signed in, or tried to, and from where. */
export const signInColumns: ColumnsType<SignIn> = [
  {
    title: "Result",
    dataIndex: "result",
    width: 200,
    render: (value: string, row) => (
      <Space size={6}>
        <Tag color={value === "SUCCESS" ? undefined : "error"} bordered={false}>
          {value === "SUCCESS" ? "Signed in" : "Failed"}
        </Tag>
        {/* Why it failed, which is the difference between a typo and
            somebody trying your password. */}
        {row.reason ? <Text type="danger">{row.reason}</Text> : null}
      </Space>
    ),
  },
  { title: "Method", dataIndex: "method", width: 100 },
  { title: "Device", dataIndex: "device", width: 120 },
  {
    title: "Where from",
    dataIndex: "ip_address",
    width: 190,
    render: (value: string | null, row) => (
      <div className="nu-sec-where">
        <Text className="nu-sec-ip">{value ?? "—"}</Text>
        <Text type="secondary">{row.location ?? "Location unknown"}</Text>
      </div>
    ),
  },
  {
    title: "When",
    dataIndex: "at",
    width: 110,
    render: (value: string | null) => (
      <Tooltip title={absoluteTime(value)}>
        <span>{relativeTime(value)}</span>
      </Tooltip>
    ),
  },
];

/** What the platform noticed; each can be marked as looked at. */
export function eventColumns(resolved: { isPending: boolean; mutate: (input: { id: string; resolved: boolean }) => void }): ColumnsType<SecurityEvent> {
  return [
    {
      title: "What happened",
      dataIndex: "title",
      render: (value: string, row) => (
        <div className="nu-sec-event">
          <Space size={6}>
            <Tag color={severityTone(row.severity)} bordered={false}>
              {row.severity.toLowerCase()}
            </Tag>
            <Text strong={!row.resolved}>{value}</Text>
          </Space>
          {row.description ? (
            <Text type="secondary" className="nu-sec-detail">
              {row.description}
            </Text>
          ) : null}
        </div>
      ),
    },
    {
      title: "Where from",
      dataIndex: "ip_address",
      width: 150,
      render: (value: string | null) => <Text className="nu-sec-ip">{value ?? "—"}</Text>,
    },
    {
      title: "When",
      dataIndex: "at",
      width: 110,
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
    {
      title: "Looked at",
      dataIndex: "resolved",
      width: 110,
      align: "center",
      render: (value: boolean, row) => (
        <Switch
          size="small"
          checked={value}
          disabled={resolved.isPending}
          aria-label={`Mark ${row.title} as looked at`}
          data-testid={`resolve-${row.id}`}
          onChange={(next) => resolved.mutate({ id: row.id, resolved: next })}
        />
      ),
    },
  ];
}
