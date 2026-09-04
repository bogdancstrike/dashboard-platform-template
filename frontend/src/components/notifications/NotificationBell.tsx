import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dropdown, Empty, Skeleton, Space, Tooltip, Typography } from "antd";
import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { notificationsApi, type Notification } from "@/api/notifications";
import { useLive, usePollInterval } from "@/live/LiveProvider";
import { absoluteTime, relativeTime } from "@/lib/time";
import { categoryIcon, severityColor } from "./presentation";

const { Text } = Typography;

/**
 * The header bell (§17): the count always, the newest few on demand.
 *
 * The count is its own endpoint rather than `list().total`, because the badge
 * is polled and a badge that costs a page of rows to refresh is a badge that
 * gets refreshed less often than it should be. The dropdown only fetches when
 * it is opened — nobody is reading it while it is closed.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const { status } = useLive();
  // Polling is the fallback, not the mechanism: while the socket is up this is
  // `false` and the badge moves when the server says so.
  const refetchInterval = usePollInterval(30_000);

  const counts = useQuery({
    queryKey: ["notifications", "counts"],
    queryFn: ({ signal }) => notificationsApi.counts(signal),
    refetchInterval,
  });

  const latest = useQuery({
    queryKey: ["notifications", "latest"],
    queryFn: ({ signal }) => notificationsApi.list({ page_size: 6 }, signal),
    enabled: open,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const markAll = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: invalidate,
  });

  const markOne = useMutation({
    mutationFn: (id: string) => notificationsApi.setRead(id, true),
    onSuccess: invalidate,
  });

  const unread = counts.data?.unread ?? 0;

  const openItem = (item: Notification) => {
    setOpen(false);
    if (!item.is_read) markOne.mutate(item.id);
    navigate(item.link ?? "/notifications");
  };

  const panel = (
    <div className="nu-bell-panel" role="menu" aria-label="Recent notifications">
      <div className="nu-bell-head">
        <Text strong>Notifications</Text>
        <Space size={4}>
          {unread > 0 && (
            <Button
              type="text"
              size="small"
              icon={<CheckOutlined />}
              loading={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          )}
        </Space>
      </div>

      {latest.isLoading ? (
        <div className="nu-bell-list">
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        </div>
      ) : latest.data && latest.data.items.length > 0 ? (
        <ul className="nu-bell-list">
          {latest.data.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`nu-bell-item${item.is_read ? "" : " nu-bell-item--unread"}`}
                onClick={() => openItem(item)}
              >
                <span className="nu-bell-icon" style={{ color: severityColor(item.severity) }}>
                  {categoryIcon(item.category)}
                </span>
                <span className="nu-bell-text">
                  <Text strong={!item.is_read} ellipsis>
                    {item.title}
                  </Text>
                  {item.body && (
                    <Text type="secondary" ellipsis>
                      {item.body}
                    </Text>
                  )}
                  <Text type="secondary" title={absoluteTime(item.created_at)}>
                    {relativeTime(item.created_at)}
                  </Text>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty
          className="nu-bell-empty"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Nothing to catch up on"
        />
      )}

      <div className="nu-bell-foot">
        <Button
          type="link"
          size="small"
          onClick={() => {
            setOpen(false);
            navigate("/notifications");
          }}
        >
          Open the notification centre
        </Button>
      </div>
    </div>
  );

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      trigger={["click"]}
      placement="bottomRight"
      popupRender={() => panel}
    >
      <Tooltip title={status === "live" ? "Notifications — live" : "Notifications"}>
        <Badge count={unread} size="small" overflowCount={99}>
          <Button
            shape="circle"
            icon={<BellOutlined />}
            aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
          />
        </Badge>
      </Tooltip>
    </Dropdown>
  );
}
