import { useQuery } from "@tanstack/react-query";
import { List, Space, Typography } from "antd";
import { Link } from "react-router-dom";

import { notificationsApi } from "@/api/notifications";
import { relativeTime } from "@/lib/time";
import { queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/** What the platform has told this reader, newest first. */
export function NotificationsBody({ widget, fallback }: ModuleBodyProps) {
  const params = {
    read: widget.config.unread_only ? "unread" : "all",
    ...(widget.config.category ? { category: widget.config.category } : {}),
    page_size: ROWS,
  };

  const page = useQuery({
    queryKey: queryKeys.notifications(params),
    queryFn: ({ signal }) => notificationsApi.list(params, signal),
    staleTime: 20_000,
  });

  if (page.isLoading) return <Loading />;
  if (page.isError) return fallback(page.error, "notifications");

  const items = page.data?.items ?? [];
  if (items.length === 0) {
    return <Nothing what={widget.config.unread_only ? "Nothing unread" : "Nothing yet"} />;
  }

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(entry) => (
          <List.Item className={entry.is_read ? undefined : "is-unread"}>
            <Link to={entry.link || "/notifications"} className="nu-widget-row">
              <Space size={6}>
                <span
                  className="nu-widget-severity"
                  data-severity={entry.severity.toLowerCase()}
                  aria-label={entry.severity.toLowerCase()}
                />
                <Text ellipsis strong={!entry.is_read}>
                  {entry.title}
                </Text>
              </Space>
              <Text type="secondary" className="nu-widget-dim">
                {relativeTime(entry.created_at)}
              </Text>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/notifications">
        {(page.data?.unread ?? 0) > 0
          ? `${page.data?.unread} unread`
          : `All ${(page.data?.total ?? 0).toLocaleString()}`}
      </MoreLink>
    </>
  );
}
