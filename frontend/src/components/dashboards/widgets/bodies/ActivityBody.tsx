import { useQuery } from "@tanstack/react-query";
import { List, Skeleton, Typography } from "antd";

import { dashboardApi } from "@/api/dashboard";
import { relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";
import { STALE, queryKeys } from "@/lib/queryKeys";

import { WidgetError } from "../WidgetError";

const { Text } = Typography;

/** The activity feed, from the same summary the home page reads. */
export function ActivityBody() {
  const summary = useQuery({
    queryKey: queryKeys.dashboardSummary("activity"),
    queryFn: ({ signal }) => dashboardApi.summary({ period: "last_7_days" }, signal),
    staleTime: STALE.minute,
  });

  if (summary.isLoading) return <Skeleton active title={false} paragraph={{ rows: 4 }} />;
  if (summary.isError) return <WidgetError error={summary.error} entity="" />;

  const items = (summary.data?.activity ?? []).slice(0, 6);
  if (items.length === 0) {
    return <EmptyState compact title="Nothing has happened yet" />;
  }

  return (
    <List
      size="small"
      dataSource={items}
      renderItem={(entry) => (
        <List.Item>
          <div className="nu-widget-row">
            <Text ellipsis>
              <Text strong>{entry.actor}</Text> {entry.summary}
            </Text>
            <Text type="secondary">{relativeTime(entry.occurred_at)}</Text>
          </div>
        </List.Item>
      )}
    />
  );
}
