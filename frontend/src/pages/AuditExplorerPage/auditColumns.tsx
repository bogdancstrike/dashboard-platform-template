import { Space, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { UserSwitchOutlined } from "@ant-design/icons";

import type { AuditRow } from "@/api/audit";
import { actionColor, humaniseAction, resultColor } from "@/components/audit/vocabulary";
import type { RowCard } from "@/components/listing/ResponsiveTable";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

/** When, who (and through whom), what, to what, how much changed, and how it ended. */
export function auditColumns(order: "asc" | "desc"): ColumnsType<AuditRow> {
  return [
    {
      title: "When",
      dataIndex: "occurred_at",
      width: 150,
      sorter: true,
      defaultSortOrder: order === "asc" ? "ascend" : "descend",
      render: (value: string) => (
        <Tooltip title={absoluteTime(value)}>
          <Text>{relativeTime(value)}</Text>
        </Tooltip>
      ),
    },
    {
      title: "Actor",
      dataIndex: "actor_label",
      width: 210,
      sorter: true,
      render: (value: string, row) => (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
          <Space size={6}>
            <Text>{value}</Text>
            {row.impersonated && (
              <Tooltip
                title={`Acting as this user: ${row.impersonator_label || "an administrator"}`}
              >
                <Tag icon={<UserSwitchOutlined />} color="purple" data-testid="impersonated">
                  via {row.impersonator_label || "an administrator"}
                </Tag>
              </Tooltip>
            )}
          </Space>
          {row.actor_role && <Text type="secondary">{row.actor_role}</Text>}
        </Space>
      ),
    },
    {
      title: "Action",
      dataIndex: "action",
      width: 170,
      sorter: true,
      render: (value: string) => <Tag color={actionColor(value)}>{humaniseAction(value)}</Tag>,
    },
    {
      title: "Resource",
      dataIndex: "resource_label",
      ellipsis: true,
      render: (value: string, row) => (
        <Space size={4} direction="vertical" style={{ lineHeight: 1.3 }}>
          <Text>{value || "—"}</Text>
          <Text type="secondary">{row.resource_type}</Text>
        </Space>
      ),
    },
    {
      title: "Changed",
      dataIndex: "changed_field_count",
      width: 100,
      align: "right",
      render: (value: number) =>
        value > 0 ? (
          <Text>{value} field{value === 1 ? "" : "s"}</Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "Result",
      dataIndex: "result",
      width: 110,
      sorter: true,
      render: (value: string) => {
        const colour = resultColor(value);
        return colour ? <Tag color={colour}>{value}</Tag> : <Text type="secondary">{value}</Text>;
      },
    },
  ];
}

/** The same entry as a card on a phone. */
export function auditCard(row: AuditRow): RowCard {
  return {
    title: row.resource_label,
    meta: `${row.actor_label} · ${relativeTime(row.occurred_at)}`,
    pill: <Tag bordered={false}>{row.action.toLowerCase()}</Tag>,
    right: row.result.toLowerCase(),
  };
}
