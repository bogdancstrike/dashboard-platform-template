import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, Dropdown, Skeleton, Space, Tooltip, Typography } from "antd";
import { BellOutlined, CheckOutlined } from "@ant-design/icons";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { notificationsApi, type Notification } from "@/api/notifications";
import { useLive, usePollInterval } from "@/live/LiveProvider";
import { absoluteTime, relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";
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
/** The kinds that ask the reader to do something, so the row offers it inline. */
const DECISIONS = new Set(["MENTION", "ASSIGNMENT", "APPROVAL"]);

export function NotificationBell() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  /** The panel's tab, filtered here over what the list returned. */
  const [tab, setTab] = useState<"all" | "unread" | "mentions">("all");
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
    queryFn: ({ signal }) => notificationsApi.list({ page_size: 20 }, signal),
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
  const mentions = counts.data?.by_category["MENTION"] ?? 0;
  const shown = (latest.data?.items ?? [])
    .filter((item) =>
      tab === "unread" ? !item.is_read : tab === "mentions" ? item.category === "MENTION" : true,
    )
    .slice(0, 6);

  const openItem = (item: Notification) => {
    setOpen(false);
    if (!item.is_read) markOne.mutate(item.id);
    navigate(item.link ?? "/notifications");
  };

  const panel = (
    <div className="nu-bell-panel" role="menu" aria-label="Recent notifications">
      <div className="nu-bell-head">
        <span className="nu-bell-title">
          Notifications{unread > 0 && <em> {unread} new</em>}
        </span>
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

      <div className="nu-bell-tabs" role="tablist" aria-label="Which notifications">
        {(
          [
            ["all", "All", latest.data?.total],
            ["unread", "Unread", unread],
            // Only offered when the platform has mentioned this reader at all:
            // a tab that can only ever be empty is a tab that teaches nothing.
            ...(mentions > 0 ? [["mentions", "Mentions", mentions] as const] : []),
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`nu-bell-tab${tab === key ? " is-on" : ""}`}
            onClick={() => setTab(key)}
            data-testid={`bell-tab-${key}`}
          >
            {label}
            {count !== undefined && <span>{count}</span>}
          </button>
        ))}
      </div>

      {latest.isLoading ? (
        <div className="nu-bell-list">
          <Skeleton active paragraph={{ rows: 4 }} title={false} />
        </div>
      ) : shown.length > 0 ? (
        <ul className="nu-bell-list">
          {shown.map((item) => (
            <li key={item.id} className="nu-bell-li">
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
                {!item.is_read && <span className="nu-bell-dot" aria-label="Unread" />}
              </button>
              {/* The row's own verbs, inline: what it is about, and the quiet
                  "seen it" that does not need a page. */}
              {(item.link || !item.is_read) && (
                <span className="nu-bell-actions">
                  {item.link && DECISIONS.has(item.category.toUpperCase()) && (
                    <Button size="small" type="primary" onClick={() => openItem(item)}>
                      Open
                    </Button>
                  )}
                  {!item.is_read && (
                    <Button size="small" onClick={() => markOne.mutate(item.id)}>
                      Mark read
                    </Button>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          compact
          title={tab === "all" ? "Nothing to catch up on" : tab === "unread" ? "All read" : "No mentions"}
        />
      )}

      <div className="nu-bell-foot">
        <Button
          block
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
