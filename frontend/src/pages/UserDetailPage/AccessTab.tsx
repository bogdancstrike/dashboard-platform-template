import { Card, Col, Descriptions, Row, Space, Tag, Tooltip, Typography } from "antd";

import type { UserDetail } from "@/api/users";
import { EdgeTag } from "@/components/EdgeTag";

const { Text } = Typography;

/** Why this person can do what they can: role, plus groups, plus the union. */
export function AccessTab({ user }: { user: UserDetail }) {
  const { access, groups } = user;
  const fromGroups = new Set(access.from_groups_only);

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={14}>
        <Card
          size="small"
          title={`Effective permissions · ${access.effective.length}`}
          data-testid="effective-permissions"
        >
          <Space size={[6, 6]} wrap>
            {access.effective.length === 0 && (
              <Text type="secondary">This account can do nothing at all.</Text>
            )}
            {access.effective.map((permission) => (
              <Tooltip
                key={permission}
                title={
                  fromGroups.has(permission)
                    ? "Granted by a group, not by the role"
                    : "Granted by the role"
                }
              >
                {/* The group-granted half is marked, because it is the half a
                    role-shaped screen cannot explain. */}
                <Tag color={fromGroups.has(permission) ? "purple" : undefined}>{permission}</Tag>
              </Tooltip>
            ))}
          </Space>
        </Card>
      </Col>
      <Col xs={24} xl={10}>
        <Card size="small" title="Where it comes from">
          <Descriptions size="small" column={1} bordered>
            <Descriptions.Item label="Role">
              {user.role_name ? (
                <Space direction="vertical" size={2}>
                  <EdgeTag color={user.role_color}>{user.role_name}</EdgeTag>
                  <Text type="secondary">
                    {access.role_permissions.length} permission
                    {access.role_permissions.length === 1 ? "" : "s"}
                  </Text>
                </Space>
              ) : (
                <Text type="secondary">No role</Text>
              )}
            </Descriptions.Item>
            {groups.length === 0 ? (
              <Descriptions.Item label="Groups">
                <Text type="secondary">None</Text>
              </Descriptions.Item>
            ) : (
              groups.map((group) => (
                <Descriptions.Item key={group.id} label={group.name}>
                  <Space size={[4, 4]} wrap>
                    {group.permissions.length === 0 ? (
                      <Text type="secondary">Adds nothing</Text>
                    ) : (
                      group.permissions.map((permission) => (
                        <Tag key={permission} color="purple">
                          {permission}
                        </Tag>
                      ))
                    )}
                  </Space>
                </Descriptions.Item>
              ))
            )}
          </Descriptions>
        </Card>
      </Col>
    </Row>
  );
}
