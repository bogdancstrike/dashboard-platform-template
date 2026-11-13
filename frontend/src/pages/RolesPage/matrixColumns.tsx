import { Checkbox, Space, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { LockOutlined } from "@ant-design/icons";

import type { RoleRow } from "@/api/roles";
import { EdgeTag } from "@/components/EdgeTag";

import { SELF_LOCKOUT_GUARD, cellKey, type MatrixRow } from "./matrix";
import type { useRolesPage } from "./useRolesPage";

const { Text } = Typography;

type Page = ReturnType<typeof useRolesPage>;

/** The permission column, then one column per role. */
export function matrixColumns(page: Page): ColumnsType<MatrixRow> {
  const { phone, folded, toggleGroup } = page;
  const data = page.data!;
  return [
    {
      title: "Permission",
      dataIndex: "label",
      fixed: "left",
      width: phone ? 150 : 280,
      render: (label: string, row) =>
        row.kind === "group" ? (
          <button
            type="button"
            className="nx-ad-grouptoggle"
            aria-expanded={!folded.has(label)}
            onClick={() => toggleGroup(label)}
          >
            <span aria-hidden="true">{folded.has(label) ? "▸" : "▾"}</span>
            <Text strong>{label}</Text>
          </button>
        ) : (
          <Space direction="vertical" size={0} style={{ lineHeight: 1.3 }}>
            <Text>{label}</Text>
            <Text type="secondary" className="nu-permission-code">
              {row.permission}
            </Text>
          </Space>
        ),
    },
    ...data.items.map((role) => ({
      key: role.code,
      width: phone ? 104 : 150,
      align: "center" as const,
      title: <RoleHeading role={role} />,
      render: (_value: unknown, row: MatrixRow) => <RoleCell role={role} row={row} page={page} />,
    })),
  ];
}

function RoleHeading({ role }: { role: RoleRow }) {
  return (
    <div className="nx-ad-rolehead">
      <EdgeTag color={role.color} style={{ marginInlineEnd: 0 }}>
        {role.name}
      </EdgeTag>
      <span className="nx-ad-rolehead-meta">
        {role.user_count} {role.user_count === 1 ? "person" : "people"}
        {role.is_yours && (
          <Tooltip title="The role you hold. Changes here affect you.">
            <Tag color="gold">yours</Tag>
          </Tooltip>
        )}
        {!role.is_system && <Tag bordered={false}>added here</Tag>}
      </span>
    </div>
  );
}

/** A group's held/total for a role, or one permission's checkbox — locked where removing it would lock you out. */
function RoleCell({ role, row, page }: { role: RoleRow; row: MatrixRow; page: Page }) {
  const { isGranted, staged, save, stage } = page;
  if (row.kind === "group") {
    const held = row.permissions.filter((code) => isGranted(role, code)).length;
    return (
      <Text type="secondary">
        {held}/{row.permissions.length}
      </Text>
    );
  }
  const granted = isGranted(role, row.permission);
  const locked = role.is_yours && SELF_LOCKOUT_GUARD.has(row.permission) && granted;
  const changed =
    staged[cellKey({ role: role.code, permission: row.permission })] !== undefined &&
    role.permissions.includes(row.permission) !== granted;

  return (
    <Tooltip
      title={
        locked
          ? "You cannot remove your own ability to administer roles — ask another administrator."
          : undefined
      }
    >
      <span className={changed ? "nu-cell-changed" : undefined}>
        <Checkbox
          checked={granted}
          disabled={locked || save.isPending}
          aria-label={`${role.name}: ${row.label}`}
          onChange={(event) => stage(role.code, row.permission, event.target.checked)}
        />
        {locked && <LockOutlined className="nu-cell-lock" />}
      </span>
    </Tooltip>
  );
}
