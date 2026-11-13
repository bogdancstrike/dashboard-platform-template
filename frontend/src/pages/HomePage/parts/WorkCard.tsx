import { Card, Skeleton, Space, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import { relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

import type { HomePageData } from "../useHomePage";

/** The reader's assigned tasks, soonest due first. */
export function WorkCard({ page }: { page: HomePageData }) {
  const { can, tasks } = page;
  return (
    <>
      {can("tasks.view") && (
        <Card
          size="small"
          title="Your work"
          data-testid="home-tasks"
          extra={
            <Link to="/tasks" className="nu-quiet-link">
              The queue
            </Link>
          }
        >
          {tasks.isLoading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : (tasks.data?.items.length ?? 0) === 0 ? (
            <EmptyState compact title="Nothing is assigned to you" />
          ) : (
            <div className="nx-ov-rows">
              {(tasks.data?.items ?? []).map((row) => (
                <div key={String(row["id"])} className="nu-home-task">
                  <Link to={`/tasks/${String(row["id"])}`} className="nu-home-task-title">
                    {String(row["title"])}
                  </Link>
                  <Space size={4}>
                    <Tag bordered={false}>{String(row["status"]).toLowerCase()}</Tag>
                    {typeof row["due_date"] === "string" && (
                      <Text
                        type={
                          new Date(row["due_date"]).valueOf() < Date.now() ? "danger" : "secondary"
                        }
                      >
                        {relativeTime(row["due_date"])}
                      </Text>
                    )}
                  </Space>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </>
  );
}
