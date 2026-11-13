import { Card, Skeleton, Tag, Tooltip, Typography } from "antd";
import { Link } from "react-router-dom";
import { clock } from "@/components/calendar/MonthGrid";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

import type { HomePageData } from "../useHomePage";

/** Today's calendar, when the reader may see one. */
export function TodayCard({ page }: { page: HomePageData }) {
  const { can, events, mine } = page;
  return (
    <>
      {can("calendar.view") && (
        <Card
          size="small"
          title="Today"
          data-testid="home-today"
          extra={
            <Link to="/calendar?view=day" className="nu-quiet-link">
              The calendar
            </Link>
          }
        >
          {events.isLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : mine.length === 0 ? (
            <EmptyState compact title="Nothing in your calendar today" />
          ) : (
            <div className="nx-ov-rows">
              {mine.map((event) => (
                <div key={event.id} className="nu-home-event">
                  <Text strong className="nu-home-event-when">
                    {event.all_day ? "All day" : clock(event.starts_at)}
                  </Text>
                  <Link to={`/calendar?view=day&on=${event.day}`} className="nu-home-event-what">
                    {event.title}
                  </Link>
                  {event.clashes_with.length > 0 && (
                    <Tooltip title={`Clashes with ${event.clashes_with.join(", ")}`}>
                      <Tag color="warning" bordered={false}>
                        clash
                      </Tag>
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
