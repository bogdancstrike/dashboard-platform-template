import { Button, Popconfirm } from "antd";
import { PlusOutlined, UndoOutlined } from "@ant-design/icons";

import type { useRolesPage } from "./useRolesPage";

type Page = ReturnType<typeof useRolesPage>;

/** New role, discard the staged changes, and apply them — confirmed, with their size. */
export function RoleActions({ page }: { page: Page }) {
  const { setCreating, setStaged, pendingCells, pending, save } = page;
  return (
    <>
      <Button
        icon={<PlusOutlined />}
        onClick={() => setCreating(true)}
        data-testid="new-role"
      >
        New role
      </Button>
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
  );
}
