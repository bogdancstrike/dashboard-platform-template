import { Card, Skeleton, Typography } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

import type { HomePageData } from "../useHomePage";

/** Where the reader has been lately. */
export function RecentsCard({ page }: { page: HomePageData }) {
  const { recents } = page;
  return (
    <>
      {/* Most mornings start by reopening whatever was open yesterday. The
          visit count is what separates a place somebody works from one they
          wandered into once, so it is on the row rather than implied by the
          order. */}
      <Card
        size="small"
        title="Jump back in"
        data-testid="home-recents"
        extra={
          <Link to="/favorites" className="nu-quiet-link">
            Favourites
          </Link>
        }
      >
        {recents.isLoading ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : (recents.data?.items.length ?? 0) === 0 ? (
          <EmptyState compact title="Nowhere yet — the trail fills itself as you work" />
        ) : (
          <div className="nx-ov-rows nx-ov-rows--plain">
            {(recents.data?.items ?? []).slice(0, 6).map((visit) => (
              <Link key={visit.id} to={visit.url} className="nu-home-recent">
                <ClockCircleOutlined aria-hidden />
                <Text ellipsis className="nu-home-recent-label">
                  {visit.label}
                </Text>
                <Text type="secondary" className="nu-home-recent-note">
                  {visit.visit_count > 1 ? `${visit.visit_count} visits` : visit.resource_type}
                </Text>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
