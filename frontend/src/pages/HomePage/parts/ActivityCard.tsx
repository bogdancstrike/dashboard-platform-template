import { Card, Skeleton, Typography } from "antd";
import { Link } from "react-router-dom";
import { relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

import type { HomePageData } from "../useHomePage";

/** The week's activity feed. */
export function ActivityCard({ page }: { page: HomePageData }) {
  const { feed } = page;
  return (
    <Card
      size="small"
      title="What has been happening"
      data-testid="home-activity"
      extra={
        <Link to="/activity" className="nu-quiet-link">
          The feed
        </Link>
      }
    >
      {feed.isLoading ? (
        <Skeleton active paragraph={{ rows: 4 }} />
      ) : (feed.data?.items.length ?? 0) === 0 ? (
        <EmptyState compact title="Nothing has happened this week" />
      ) : (
        <div className="nx-ov-rows">
          {(feed.data?.items ?? []).slice(0, 6).map((entry) => (
            <div key={entry.id} className="nu-home-feed">
              <Text>
                {entry.actor.name && <strong>{entry.actor.name}</strong>} {entry.summary}
              </Text>
              <Text type="secondary" className="nu-home-feed-when">
                {relativeTime(entry.occurred_at)}
              </Text>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
