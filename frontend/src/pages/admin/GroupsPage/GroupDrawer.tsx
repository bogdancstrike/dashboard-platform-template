import { Alert, Button, Drawer, Popconfirm, Skeleton, Space, Tag, Typography } from "antd";
import { DeleteOutlined } from "@ant-design/icons";
import type { UseQueryResult } from "@tanstack/react-query";

import type { GroupDetail } from "@/api/groups";
import { URL_OVERLAY } from "@/app/history";
import { apiMessage } from "@/lib/errors";

import { GroupGrants } from "./GroupGrants";
import { GroupMembers } from "./GroupMembers";
import { removalCost } from "./groupCopy";

const { Text } = Typography;

interface GroupDrawerProps {
  open: boolean;
  onClose: () => void;
  detail: UseQueryResult<GroupDetail>;
  onRemove: (id: string) => void;
  removing: boolean;
  permissions: Array<{ code: string; label: string }>;
  canMembers: boolean;
  canGrants: boolean;
  onSaved: () => Promise<void>;
  onError: (error: unknown) => void;
}

/** One group: who is in it and what it adds, each on its own privilege. */
export function GroupDrawer({ open, onClose, detail, onRemove, removing, canMembers, ...panels }: GroupDrawerProps) {
  const group = detail.data;
  return (
    <Drawer
      className="nx-ad-drawer"
      open={open}
      rootClassName={URL_OVERLAY}
      onClose={onClose}
      width={640}
      title={group?.name ?? "Group"}
      destroyOnClose
      extra={
        group && canMembers ? (
          <Popconfirm
            title={`Remove ${group.name}?`}
            description={removalCost(group)}
            okText="Remove it"
            okButtonProps={{ danger: true }}
            onConfirm={() => onRemove(group.id)}
          >
            <Button danger icon={<DeleteOutlined />} loading={removing} data-testid="remove-group">
              Remove
            </Button>
          </Popconfirm>
        ) : undefined
      }
    >
      {detail.isLoading && <Skeleton active paragraph={{ rows: 8 }} />}
      {detail.isError && <Alert type="error" showIcon message={apiMessage(detail.error, "That group could not be read.")} />}
      {group && <GroupPanels group={group} canMembers={canMembers} {...panels} />}
    </Drawer>
  );
}

/**
 * The two panels, each available on its own privilege.
 *
 * Kept together because they describe one group, and split into two *saves*
 * because they are two privileges: an editor that saved both at once would
 * need both, and a manager would be unable to use the half they hold.
 */
function GroupPanels({
  group,
  permissions,
  canMembers,
  canGrants,
  onSaved,
  onError,
}: Omit<GroupDrawerProps, "open" | "onClose" | "detail" | "onRemove" | "removing"> & { group: GroupDetail }) {
  return (
    <Space direction="vertical" size={20} className="nu-block">
      <div>
        <Space size={8}>
          <Tag bordered={false}>{group.kind.toLowerCase()}</Tag>
          <Text type="secondary" className="nu-mono">
            {group.slug}
          </Text>
        </Space>
        {group.description && <p className="nu-group-about">{group.description}</p>}
      </div>
      <GroupMembers group={group} canMembers={canMembers} onSaved={onSaved} onError={onError} />
      <GroupGrants group={group} permissions={permissions} canGrants={canGrants} onSaved={onSaved} onError={onError} />
    </Space>
  );
}
