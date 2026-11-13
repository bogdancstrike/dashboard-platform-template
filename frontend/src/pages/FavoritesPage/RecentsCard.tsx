import { Button, Card, Popconfirm, Skeleton, Table, Tag, Tooltip, Typography } from "antd";
import { DeleteOutlined, StarFilled, StarOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router-dom";
import { type RecentVisit } from "@/api/favorites";
import { formatNumber } from "@/lib/formats";
import { absoluteTime, relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";
import { KindPill } from "./KindPill";

import type { FavoritesPageModel } from "./useFavoritesPage";

/** What the reader opened lately, with a star to keep it. */
export function RecentsCard({ m }: { m: FavoritesPageModel }) {
  const { recents, cleared, starred } = m;
  const { Text } = Typography;
  const recentColumns: ColumnsType<RecentVisit> = [
    {
      title: "What",
      dataIndex: "label",
      render: (value: string, row) => (
        <div className="nu-fav-what">
          <Link to={row.url} className="nu-fav-link">
            {value}
          </Link>
        </div>
      ),
    },
    {
      title: "Type",
      dataIndex: "resource_type",
      width: 150,
      // Below a phone's width the name needs the room; the kind is in the filter.
      className: "nx-fd-wide-only",
      render: (value: string) => <KindPill kind={value} />,
    },
    {
      title: "Visits",
      dataIndex: "visit_count",
      width: 90,
      className: "nx-fd-wide-only",
      align: "right",
      // What separates a place somebody works from one they wandered into
      // once, which is the only thing this list can say that a bookmark
      // cannot.
      render: (value: number) => <Text>{formatNumber(value)}</Text>,
    },
    {
      title: "Last opened",
      dataIndex: "visited_at",
      width: 130,
      className: "nx-fd-wide-only",
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
    {
      title: "",
      width: 60,
      align: "right",
      render: (_value, row) =>
        row.is_favorite ? (
          // The row already knows, so no request is needed to find out — and
          // unstarring belongs in the list that owns the arrangement.
          <Tooltip title="Already kept. Remove it from the list above.">
            <StarFilled className="nu-fav-kept" aria-label={`${row.label} is kept`} />
          </Tooltip>
        ) : (
          <Tooltip title="Keep this">
            <Button
              type="text"
              icon={<StarOutlined />}
              aria-label={`Keep ${row.label}`}
              data-testid={`keep-${row.id}`}
              loading={starred.isPending && starred.variables.id === row.id}
              onClick={() => starred.mutate(row)}
            />
          </Tooltip>
        ),
    },
  ];
  return (
    <Card
      size="small"
      title="Looked at lately"
      className="nu-fav-card"
      data-testid="recents-card"
      extra={
        <Popconfirm
          title="Forget what you have looked at?"
          description="The whole trail goes — one entry removed from a trail leaves a misleading one. Your favourites are untouched."
          okText="Forget it"
          cancelText="Keep it"
          onConfirm={() => cleared.mutate()}
        >
          <Button
            icon={<DeleteOutlined />}
            data-testid="clear-recents"
            loading={cleared.isPending}
            disabled={!recents.data?.total}
          >
            Forget these
          </Button>
        </Popconfirm>
      }
    >
      {recents.isLoading ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : (
        <>
          <Table<RecentVisit>
            data-testid="recents-table"
            rowKey="id"
            size="small"
            dataSource={recents.data?.items ?? []}
            columns={recentColumns}
            pagination={false}
            locale={{
              emptyText: (
                <EmptyState title="Nothing yet. Records, reports and saved searches you open appear here." />
              ),
            }}
          />
          {recents.data?.total ? (
            <Text type="secondary" className="nu-fav-note" data-testid="recents-note">
              The last {formatNumber(recents.data.kept)} are kept. This list is a
              by-product of opening things, not a list you curate —{" "}
              <Tag bordered={false}>
                <StarOutlined /> keeps one
              </Tag>{" "}
              above.
            </Text>
          ) : null}
        </>
      )}
    </Card>
  );
}
