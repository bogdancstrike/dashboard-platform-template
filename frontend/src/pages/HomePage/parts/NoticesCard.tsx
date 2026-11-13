import { Card, Skeleton, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/EmptyState";

const { Paragraph, Text } = Typography;

import type { HomePageData } from "../useHomePage";

/** The live notices. */
export function NoticesCard({ page }: { page: HomePageData }) {
  const { notices, live } = page;
  return (
    <Card
      size="small"
      title="What the platform has said"
      data-testid="home-notices"
      extra={
        <Link to="/announcements" className="nu-quiet-link">
          The noticeboard
        </Link>
      }
    >
      {notices.isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : live.length === 0 ? (
        <EmptyState compact title="No notices are live" />
      ) : (
        <Space direction="vertical" size={10} className="nu-block">
          {live.map((notice) => (
            <div key={notice.id} className="nu-home-notice">
              <Space size={6}>
                <Tag
                  color={
                    notice.severity === "CRITICAL"
                      ? "error"
                      : notice.severity === "WARNING"
                        ? "warning"
                        : undefined
                  }
                  bordered={false}
                >
                  {notice.severity.toLowerCase()}
                </Tag>
                <Link to="/announcements">
                  <Text strong>{notice.title}</Text>
                </Link>
              </Space>
              <Paragraph className="nu-home-notice-body" ellipsis={{ rows: 2 }}>
                {notice.body}
              </Paragraph>
            </div>
          ))}
        </Space>
      )}
    </Card>
  );
}
