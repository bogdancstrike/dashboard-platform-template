import { Space, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { SafetyCertificateOutlined, UserOutlined } from "@ant-design/icons";

import type { UserRow } from "@/api/users";
import { EdgeTag } from "@/components/EdgeTag";
import type { RowCard } from "@/components/listing/ResponsiveTable";
import { PersonAvatar } from "@/components/PersonAvatar";
import { StatusTag } from "@/components/StatusTag";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;

/** Who they are, what they may do, whether the account is live, and when it was last used. */
export function userColumns(order: "asc" | "desc"): ColumnsType<UserRow> {
  return [
    {
      title: "Name",
      dataIndex: "full_name",
      sorter: true,
      defaultSortOrder: order === "asc" ? "ascend" : "descend",
      render: (name: string, row) => (
        <Space size={10}>
          <PersonAvatar
            size="small"
            src={row.avatar_url}
            initials={row.initials}
            icon={!row.avatar_url ? <UserOutlined /> : undefined}
          />
          <span className="nx-ad-main">
            <span>{name}</span>
            <span>{row.email}</span>
          </span>
        </Space>
      ),
    },
    {
      title: "Role",
      dataIndex: "role_code",
      width: 170,
      sorter: true,
      render: (_code: string | null, row) =>
        row.role_name ? (
          <EdgeTag color={row.role_color}>{row.role_name}</EdgeTag>
        ) : (
          <Text type="secondary">No role</Text>
        ),
    },
    {
      // Groups add permissions on top of the role, so an administrator
      // looking at "why can they do that?" needs them beside it.
      title: "Groups",
      key: "groups",
      width: 220,
      render: (_: unknown, row) =>
        row.group_names.length ? (
          <Tooltip title="Adds permissions on top of the role">
            <span className="nx-ad-muted">{row.group_names.join(", ")}</span>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 130,
      sorter: true,
      render: (value: string) => <StatusTag status={value} />,
    },
    {
      title: "Last sign-in",
      dataIndex: "last_login_at",
      width: 150,
      sorter: true,
      render: (value: string | null) =>
        value ? (
          <Tooltip title={absoluteTime(value)}>
            <Text>{relativeTime(value)}</Text>
          </Tooltip>
        ) : (
          <Text type="secondary">Never</Text>
        ),
    },
    {
      title: "MFA",
      dataIndex: "mfa_enabled",
      width: 90,
      align: "center",
      render: (enabled: boolean) =>
        enabled ? (
          <Tooltip title="Multi-factor authentication is on">
            <SafetyCertificateOutlined className="nu-mfa-on" />
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
  ];
}

/** The same person as a card on a phone. */
export function userCard(row: UserRow): RowCard {
  return {
    lead: <PersonAvatar size="small" src={row.avatar_url} initials={row.initials} />,
    title: row.full_name,
    meta: [row.email, row.group_names.join(", ")].filter(Boolean).join(" · "),
    pill: row.role_name ? <EdgeTag color={row.role_color}>{row.role_name}</EdgeTag> : undefined,
    right: <StatusTag status={row.status} />,
  };
}
