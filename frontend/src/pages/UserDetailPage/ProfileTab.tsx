import { Card, Descriptions, Tooltip, Typography } from "antd";

import type { UserDetail } from "@/api/users";
import { absoluteTime, relativeTime } from "@/lib/time";

const { Text } = Typography;


export function ProfileTab({ user }: { user: UserDetail }) {
  return (
    <Card size="small">
      <Descriptions size="small" column={{ xs: 1, md: 2 }} bordered>
        <Descriptions.Item label="Username">{user.username}</Descriptions.Item>
        <Descriptions.Item label="Email">{user.email}</Descriptions.Item>
        <Descriptions.Item label="Phone">
          {user.phone || <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Job title">
          {user.job_title || <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Organization">
          {user.organization?.name ?? <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Department">
          {user.department?.name ?? <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Manager">
          {user.manager?.name ?? <Text type="secondary">—</Text>}
        </Descriptions.Item>
        <Descriptions.Item label="Locale">
          {user.locale} · {user.timezone}
        </Descriptions.Item>
        <Descriptions.Item label="Sign-ins">{user.login_count}</Descriptions.Item>
        <Descriptions.Item label="Last sign-in">
          {user.last_login_at ? (
            <Tooltip title={absoluteTime(user.last_login_at)}>
              <span>{relativeTime(user.last_login_at)}</span>
            </Tooltip>
          ) : (
            <Text type="secondary">Never</Text>
          )}
        </Descriptions.Item>
        <Descriptions.Item label="Profile complete">
          {user.profile_completeness}%
        </Descriptions.Item>
      </Descriptions>
    </Card>
  );
}
