import { Alert, Button, Card, Skeleton, Space, Table, Tag } from "antd";

import { ApiError } from "@/api/client";
import { CollapseAllToggle } from "@/components/CollapseAllToggle";
import { EdgeTag } from "@/components/EdgeTag";
import { PageHeader } from "@/components/PageHeader";
import { apiErrorDetails } from "@/components/feedback/apiErrorDetails";
import { ListBar } from "@/components/listing/ListBar";
import { NewRoleModal } from "@/components/roles/NewRoleModal";
import { queryKeys } from "@/lib/queryKeys";

import { CustomRoles } from "./CustomRoles";
import { RoleActions } from "./RoleActions";
import { buildRows, type MatrixRow } from "./matrix";
import { matrixColumns } from "./matrixColumns";
import { useRolesPage } from "./useRolesPage";

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
export default function RolesPage() {
  const page = useRolesPage();
  const { phone, creating, setCreating, term, setTerm, folded, setFolded, matrix, data, remove, queryClient } = page;

  if (matrix.isLoading) return <Skeleton active paragraph={{ rows: 12 }} />;

  if (matrix.isError) {
    const error = matrix.error;
    const forbidden = error instanceof ApiError && error.isForbidden;
    return (
      <div className="nx-ad nx-ad--roles">
        <PageHeader title={<>Roles & <em>permissions</em></>} />
        <Alert
          type={forbidden ? "warning" : "error"}
          showIcon
          message={
            forbidden
              ? "You do not have permission to administer roles"
              : "The permission matrix could not be loaded"
          }
          description={apiErrorDetails(error)}
          action={
            <Button onClick={() => void matrix.refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const allRows = buildRows(data!, term);
  const groupNames = allRows.filter((row) => row.kind === "group").map((row) => row.label);
  // A folded group keeps its heading — with its held/total counts per role —
  // and hides its permissions.
  let currentGroup = "";
  const rows = allRows.filter((row) => {
    if (row.kind === "group") {
      currentGroup = row.label;
      return true;
    }
    return !folded.has(currentGroup);
  });

  return (
    <div className="nx-ad nx-ad--roles">
      <PageHeader
        title={<>Roles & <em>permissions</em></>}
        subtitle="Every permission the code checks for, and which roles grant it. A change applies to the holder's next request — no re-login."
        tag={
          <Space size={6}>
            <Tag color="blue">{data!.permissions.total} permissions</Tag>
            <Tag>{data!.total} roles</Tag>
          </Space>
        }
        actions={<RoleActions page={page} />}
      />

      {data!.items.some((role) => !role.is_system) && (
        <CustomRoles roles={data!.items.filter((role) => !role.is_system)} removing={remove.isPending} onRemove={(code) => remove.mutate(code)} />
      )}

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
                  <EdgeTag key={role.code} color={role.color}>
                    {role.name}
                  </EdgeTag>
                ))}
            </Space>
          }
        />
      )}

      <ListBar
        search={{
          placeholder: "Filter permissions by name or code",
          "aria-label": "Filter permissions",
          value: term,
          onChange: (event) => setTerm(event.target.value),
        }}
      >
        <CollapseAllToggle
          label="permission groups"
          allCollapsed={groupNames.length > 0 && groupNames.every((name) => folded.has(name))}
          onToggle={(collapse) => setFolded(collapse ? new Set(groupNames) : new Set())}
        />
      </ListBar>

      <Card size="small" className="nu-block">
        <Table<MatrixRow>
          rowKey="key"
          size="small"
          pagination={false}
          columns={matrixColumns(page)}
          dataSource={rows}
          scroll={{ x: (phone ? 150 : 280) + data!.items.length * (phone ? 104 : 150) }}
          rowClassName={(row) => (row.kind === "group" ? "nu-matrix-group" : "")}
          locale={{ emptyText: `No permission matches “${term}”.` }}
        />
      </Card>

      <NewRoleModal
        open={creating}
        roles={data!.items}
        groups={data!.permissions.groups}
        onClose={() => setCreating(false)}
        onCreated={() => {
          setCreating(false);
          void queryClient.invalidateQueries({ queryKey: queryKeys.admin("roles") });
        }}
      />
    </div>
  );
}
