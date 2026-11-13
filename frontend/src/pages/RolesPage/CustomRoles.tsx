import { Button, Card, Popconfirm, Space, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";

import type { RoleRow } from "@/api/roles";
import { EdgeTag } from "@/components/EdgeTag";

const { Text } = Typography;

/**
 * The roles this installation added, with the one destructive control on the
 * page. Not in the column headings: those are 150 pixels wide inside a table
 * that scrolls sideways, so a red icon there is both cramped and — once the
 * table is scrolled — unreachable. A short strip is calmer and says what it is.
 */
export function CustomRoles({ roles, removing, onRemove }: { roles: RoleRow[]; removing: boolean; onRemove: (code: string) => void }) {
  return (
    <Card size="small" className="nu-block" data-testid="custom-roles">
      <Space size={12} wrap>
        <Text type="secondary">Roles added here:</Text>
        {roles
          .map((role) => (
            <Space key={role.code} size={4}>
              <EdgeTag color={role.color} style={{ marginInlineEnd: 0 }}>
                {role.name}
              </EdgeTag>
              <Text type="secondary">
                {role.user_count} {role.user_count === 1 ? "person" : "people"}
              </Text>
              <Popconfirm
                title={`Delete ${role.name}?`}
                description={
                  role.user_count > 0
                    ? `${role.user_count} ${role.user_count === 1 ? "person holds" : "people hold"} it — move them to another role first.`
                    : "Nobody holds it, and it is not one of the built-in roles."
                }
                okText="Delete"
                okButtonProps={{ danger: true }}
                disabled={role.user_count > 0}
                onConfirm={() => onRemove(role.code)}
              >
                <Button
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  loading={removing}
                  disabled={role.user_count > 0}
                  aria-label={`Delete the ${role.name} role`}
                  data-testid={`delete-role-${role.code}`}
                />
              </Popconfirm>
            </Space>
          ))}
      </Space>
    </Card>
  );
}
