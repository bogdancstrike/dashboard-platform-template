import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Checkbox,
  Input,
  Popconfirm,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { LockOutlined, UndoOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";

import { ApiError } from "@/api/client";
import { rolesApi, type RoleMatrix, type RoleRow } from "@/api/roles";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";

const { Text } = Typography;

/**
 * The permission matrix (§13).
 *
 * This is the screen that explains the authorization model, so it is built
 * from the two things that actually decide access rather than from a
 * description of them: the permission catalogue the code checks against, and
 * the `roles` table the API reads on every request. Every permission an
 * endpoint can require appears here, and granting one changes what its holders
 * may do on their **next request** — no re-login, no cache to invalidate.
 *
 * Edits are staged rather than applied per click (§73). A permission change is
 * not a preference: the reader should be able to see the whole shape of what
 * they are about to do — six cells across three roles — and then confirm it,
 * rather than firing six writes at the authorization model while thinking.
 */
interface Cell {
  role: string;
  permission: string;
}

const cellKey = (cell: Cell) => `${cell.role}:${cell.permission}`;

/** Permissions that may not be taken from your own role; the server agrees. */
const SELF_LOCKOUT_GUARD = new Set(["roles.manage", "admin.access"]);

export default function RolesPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  /** Staged toggles, keyed `ROLE:permission`, valued by the intended state. */
  const [staged, setStaged] = useState<Record<string, boolean>>({});

  const matrix = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: ({ signal }) => rolesApi.matrix(signal),
  });

  const save = useMutation({
    mutationFn: async (changes: { code: string; permissions: string[] }[]) => {
      // One request per role rather than one for all of them: each is audited
      // as its own change, and a refusal names the role it refused.
      for (const change of changes) {
        await rolesApi.update(change.code, { permissions: change.permissions });
      }
    },
    onSuccess: async (_result, changes) => {
      setStaged({});
      await queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
      // The caller's own permissions may have just changed.
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      message.success(
        `${changes.length} role${changes.length === 1 ? "" : "s"} updated. It applies to the next request each holder makes.`,
      );
    },
    onError: (error) => {
      message.error(
        error instanceof ApiError
          ? `${error.message} · ${error.correlationId}`
          : "The change could not be saved.",
      );
    },
  });

  const data = matrix.data;

  /** What a cell should show: the staged value if there is one, else the truth. */
  const isGranted = (role: RoleRow, permission: string) => {
    const key = cellKey({ role: role.code, permission });
    return staged[key] ?? role.permissions.includes(permission);
  };

  const pending = useMemo(() => {
    if (!data) return [];
    const byRole = new Map<string, Set<string>>();
    for (const [key, granted] of Object.entries(staged)) {
      const [code, permission] = key.split(":") as [string, string];
      const role = data.items.find((item) => item.code === code);
      if (!role) continue;
      if (role.permissions.includes(permission) === granted) continue;
      const set = byRole.get(code) ?? new Set(role.permissions);
      if (granted) set.add(permission);
      else set.delete(permission);
      byRole.set(code, set);
    }
    return [...byRole.entries()].map(([code, permissions]) => ({
      code,
      permissions: [...permissions].sort(),
    }));
  }, [staged, data]);

  const pendingCells = Object.entries(staged).filter(([key, granted]) => {
    const [code, permission] = key.split(":") as [string, string];
    const role = data?.items.find((item) => item.code === code);
    return role ? role.permissions.includes(permission) !== granted : false;
  }).length;

  usePageCommands("roles", [
    {
      id: "roles.discard",
      label: "Discard staged permission changes",
      keywords: "reset revert",
      run: () => setStaged({}),
    },
  ]);

  if (matrix.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (matrix.isError) {
    const error = matrix.error;
    const forbidden = error instanceof ApiError && error.isForbidden;
    return (
      <>
        <PageHeader title="Roles & permissions" />
        <Alert
          type={forbidden ? "warning" : "error"}
          showIcon
          message={
            forbidden
              ? "You do not have permission to administer roles"
              : "The permission matrix could not be loaded"
          }
          description={
            error instanceof ApiError ? (
              <Space direction="vertical" size={4}>
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
            <Button size="small" onClick={() => void matrix.refetch()}>
              Retry
            </Button>
          }
        />
      </>
    );
  }

  const rows = buildRows(data!, term);

  const columns: ColumnsType<MatrixRow> = [
    {
      title: "Permission",
      dataIndex: "label",
      fixed: "left",
      width: 280,
      render: (label: string, row) =>
        row.kind === "group" ? (
          <Text strong>{label}</Text>
        ) : (
          <Space direction="vertical" size={0} style={{ lineHeight: 1.3 }}>
            <Text>{label}</Text>
            <Text type="secondary" className="nu-permission-code">
              {row.permission}
            </Text>
          </Space>
        ),
    },
    ...data!.items.map((role) => ({
      key: role.code,
      width: 150,
      align: "center" as const,
      title: (
        <Space direction="vertical" size={2} style={{ lineHeight: 1.3 }}>
          <Space size={4}>
            <Tag color={role.color} style={{ marginInlineEnd: 0 }}>
              {role.name}
            </Tag>
            {role.is_yours && (
              <Tooltip title="The role you hold. Changes here affect you.">
                <Tag color="gold">yours</Tag>
              </Tooltip>
            )}
          </Space>
          <Text type="secondary">
            {role.user_count} {role.user_count === 1 ? "person" : "people"}
          </Text>
        </Space>
      ),
      render: (_value: unknown, row: MatrixRow) => {
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
                onChange={(event) =>
                  setStaged((current) => ({
                    ...current,
                    [cellKey({ role: role.code, permission: row.permission })]:
                      event.target.checked,
                  }))
                }
              />
              {locked && <LockOutlined className="nu-cell-lock" />}
            </span>
          </Tooltip>
        );
      },
    })),
  ];

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        subtitle="Every permission the code checks for, and which roles grant it. A change applies to the holder's next request — no re-login."
        tag={
          <Space size={6}>
            <Tag color="blue">{data!.permissions.total} permissions</Tag>
            <Tag>{data!.total} roles</Tag>
          </Space>
        }
        actions={
          <>
            {pendingCells > 0 && (
              <Button icon={<UndoOutlined />} onClick={() => setStaged({})}>
                Discard
              </Button>
            )}
            <Popconfirm
              title="Apply these permission changes?"
              description={
                <span>
                  {pendingCells} change{pendingCells === 1 ? "" : "s"} across{" "}
                  {pending.length} role{pending.length === 1 ? "" : "s"}. Holders are
                  affected on their next request.
                </span>
              }
              okText="Apply"
              disabled={pendingCells === 0}
              onConfirm={() => save.mutate(pending)}
            >
              <Button
                type="primary"
                disabled={pendingCells === 0}
                loading={save.isPending}
                data-testid="save-roles"
              >
                {pendingCells > 0 ? `Save ${pendingCells} change${pendingCells === 1 ? "" : "s"}` : "Save"}
              </Button>
            </Popconfirm>
          </>
        }
      />

      {data!.items.some((role) => role.customised) && (
        <Alert
          className="nu-block"
          type="info"
          showIcon
          message="Some roles differ from the permissions this platform ships with"
          description={
            <Space size={6} wrap>
              {data!.items
                .filter((role) => role.customised)
                .map((role) => (
                  <Tag key={role.code} color={role.color}>
                    {role.name}
                  </Tag>
                ))}
            </Space>
          }
        />
      )}

      <Card size="small" className="nu-filter-bar">
        <Input.Search
          allowClear
          placeholder="Filter permissions"
          aria-label="Filter permissions"
          style={{ width: 320 }}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
      </Card>

      <Card size="small" className="nu-block">
        <Table<MatrixRow>
          rowKey="key"
          size="small"
          pagination={false}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 280 + data!.items.length * 150 }}
          rowClassName={(row) => (row.kind === "group" ? "nu-matrix-group" : "")}
          locale={{ emptyText: `No permission matches “${term}”.` }}
        />
      </Card>
    </>
  );
}

/** A permission row, or the heading of the group it belongs to. */
interface MatrixRow {
  key: string;
  kind: "group" | "permission";
  label: string;
  permission: string;
  /** For a group heading: the codes it covers, so it can show "4/7". */
  permissions: string[];
}

/**
 * The matrix, flattened into rows with their group headings interleaved.
 *
 * A heading whose group has been filtered away is not rendered: a screen of
 * empty section titles is a worse answer than a short list.
 */
function buildRows(data: RoleMatrix, term: string): MatrixRow[] {
  const needle = term.trim().toLowerCase();
  const rows: MatrixRow[] = [];

  for (const group of data.permissions.groups) {
    const matching = group.permissions.filter(
      (permission) =>
        !needle ||
        permission.label.toLowerCase().includes(needle) ||
        permission.code.toLowerCase().includes(needle),
    );
    if (matching.length === 0) continue;

    rows.push({
      key: `group:${group.name}`,
      kind: "group",
      label: group.name,
      permission: "",
      permissions: matching.map((permission) => permission.code),
    });
    for (const permission of matching) {
      rows.push({
        key: permission.code,
        kind: "permission",
        label: permission.label,
        permission: permission.code,
        permissions: [],
      });
    }
  }
  return rows;
}
