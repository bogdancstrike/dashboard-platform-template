import { useQuery } from "@tanstack/react-query";
import { List, Space, Tag, Typography } from "antd";
import { PushpinFilled } from "@ant-design/icons";
import { Link } from "react-router-dom";

import { announcementsApi } from "@/api/announcements";
import { relativeTime } from "@/lib/time";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { Loading, MoreLink, Nothing, ROWS, type ModuleBodyProps } from "./shared";

const { Text } = Typography;

/** What has been announced, pinned first — the order the page itself uses. */
export function AnnouncementsBody({ widget, fallback }: ModuleBodyProps) {
  const params = widget.config.category ? { category: widget.config.category } : {};

  const feed = useQuery({
    queryKey: queryKeys.announcements(params),
    queryFn: ({ signal }) => announcementsApi.feed(params, signal),
    staleTime: STALE.minute,
  });

  if (feed.isLoading) return <Loading />;
  if (feed.isError) return fallback(feed.error, "announcements");

  const items = (feed.data?.items ?? []).slice(0, ROWS);
  if (items.length === 0) return <Nothing what="Nothing has been announced" />;

  return (
    <>
      <List
        size="small"
        dataSource={items}
        renderItem={(item) => (
          <List.Item className={item.read_at ? undefined : "is-unread"}>
            <Link to="/announcements" className="nu-widget-row">
              <Space size={6}>
                {item.is_pinned && <PushpinFilled aria-label="Pinned" />}
                <Text ellipsis strong={!item.read_at}>
                  {item.title}
                </Text>
              </Space>
              <Space size={4}>
                {item.requires_acknowledgement && !item.acknowledged_at && (
                  <Tag bordered={false} color="warning">
                    acknowledge
                  </Tag>
                )}
                <Text type="secondary" className="nu-widget-dim">
                  {relativeTime(item.publish_at ?? item.created_at)}
                </Text>
              </Space>
            </Link>
          </List.Item>
        )}
      />
      <MoreLink to="/announcements">
        {(feed.data?.unread ?? 0) > 0 ? `${feed.data?.unread} unread` : "All announcements"}
      </MoreLink>
    </>
  );
}
