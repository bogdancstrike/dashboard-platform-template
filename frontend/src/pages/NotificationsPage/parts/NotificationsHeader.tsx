import { Button, Space, Tag, Tooltip } from "antd";
import { CheckOutlined, GroupOutlined } from "@ant-design/icons";

import { PageHeader } from "@/components/PageHeader";

import type { NotificationsPageData } from "../useNotificationsPage";

/** The title, the unread count and the bulk actions. */
export function NotificationsHeader({ view }: { view: NotificationsPageData }) {
  const { status, grouped, markAll, set, unread } = view;
  return (
    <PageHeader
      title="Notifications"
      subtitle="Everything addressed to you — mentions, assignments, approvals, security and system messages."
      tag={
        <Space size={6}>
          <Tag color={unread > 0 ? "blue" : undefined} data-testid="unread-count">
            {unread} unread
          </Tag>
          <Tooltip
            title={
              status === "live"
                ? "Connected — new notifications arrive without a reload"
                : "The live channel is unavailable, so this page refreshes on a timer instead"
            }
          >
            <Tag color={status === "live" ? "green" : "default"} data-testid="live-status">
              {status === "live" ? "Live" : "Polling"}
            </Tag>
          </Tooltip>
        </Space>
      }
      actions={
        <>
          <Button
            icon={<GroupOutlined />}
            type={grouped ? "primary" : "default"}
            aria-pressed={grouped}
            onClick={() => set({ group: grouped ? null : "1", page: null })}
          >
            {grouped ? "Grouped" : "Group similar"}
          </Button>
          <Button
            icon={<CheckOutlined />}
            disabled={unread === 0}
            loading={markAll.isPending}
            onClick={() => markAll.mutate({})}
          >
            Mark all read
          </Button>
        </>
      }
    />
  );
}
