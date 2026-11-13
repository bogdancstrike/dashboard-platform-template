import { Button, Popconfirm, Space, Tag, Tooltip, Typography } from "antd";
import { SafetyCertificateOutlined, UserOutlined, UserSwitchOutlined } from "@ant-design/icons";

import type { UserDetail } from "@/api/users";
import { EdgeTag } from "@/components/EdgeTag";
import { PageHeader } from "@/components/PageHeader";
import { PersonAvatar } from "@/components/PersonAvatar";
import { StatusTag } from "@/components/StatusTag";

import type { useUserDetailPage } from "./useUserDetailPage";

const { Text } = Typography;

type Page = ReturnType<typeof useUserDetailPage>;

/** The person, their status, role and MFA, and — where allowed — viewing the platform as them. */
export function UserHeader({ page, user, onBack }: { page: Page; user: UserDetail; onBack: () => void }) {
  return (
    <PageHeader
      title={
        <Space size={10}>
          <PersonAvatar
            src={user.avatar_url}
            initials={user.initials}
            icon={!user.avatar_url ? <UserOutlined /> : undefined}
          />
          {user.full_name}
        </Space>
      }
      onBack={onBack}
      subtitle={
        <Space size={10} wrap>
          <Text type="secondary">{user.email}</Text>
          {user.job_title && <Text type="secondary">{user.job_title}</Text>}
          {user.organization && <Text type="secondary">{user.organization.name}</Text>}
        </Space>
      }
      tag={
        <Space size={6}>
          <StatusTag status={user.status} data-testid="user-status" />
          {user.role_name && <EdgeTag color={user.role_color}>{user.role_name}</EdgeTag>}
          {user.mfa_enabled && (
            <Tooltip title="Multi-factor authentication is on">
              <Tag icon={<SafetyCertificateOutlined />}>MFA</Tag>
            </Tooltip>
          )}
        </Space>
      }
      actions={<Impersonate page={page} user={user} />}
    />
  );
}

function Impersonate({ page, user }: { page: Page; user: UserDetail }) {
  const { impersonationOn, startImpersonating } = page;
  return (
    <>
      {!impersonationOn ? null : user.can_impersonate ? (
        <Popconfirm
          title={`Act as ${user.full_name}?`}
          description="You will see the platform exactly as they do. Every action is audited under both names."
          okText="Start"
          onConfirm={() => void startImpersonating(user.id)}
        >
          <Button icon={<UserSwitchOutlined />} data-testid="impersonate">
            View as this person
          </Button>
        </Popconfirm>
      ) : (
        user.impersonation_blocked_because && (
          <Tooltip title={user.impersonation_blocked_because}>
            <Button icon={<UserSwitchOutlined />} disabled data-testid="impersonate">
              View as this person
            </Button>
          </Tooltip>
        )
      )}
    </>
  );
}
