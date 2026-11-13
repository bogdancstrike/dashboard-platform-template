import { Button, Card, Segmented, Space, Table, Tooltip, Typography } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, StarFilled } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router-dom";
import { type Bookmark } from "@/api/favorites";
import { absoluteTime, relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";
import { KindPill } from "./KindPill";
import { capacityNote, kindLabel, movedOrder } from "./favorites";

import type { FavoritesPageModel } from "./useFavoritesPage";

/** The bookmarks, by kind, in the reader's own order. */
export function BookmarksCard({ m }: { m: FavoritesPageModel }) {
  const { kind, setKind, list, items, arranged, removed } = m;
  const { Text } = Typography;
  const bookmarkColumns: ColumnsType<Bookmark> = [
    {
      title: "What",
      dataIndex: "label",
      render: (value: string, row) => (
        <div className="nu-fav-what">
          {/* Opens what it points at. The address is stored, so it keeps
              working after a rename and after a router change. */}
          <Link to={row.url} className="nu-fav-link" data-testid={`open-${row.id}`}>
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
      title: "Kept",
      dataIndex: "added_at",
      width: 120,
      className: "nx-fd-wide-only",
      render: (value: string | null) => (
        <Tooltip title={absoluteTime(value)}>
          <span>{relativeTime(value)}</span>
        </Tooltip>
      ),
    },
    {
      title: "",
      width: 150,
      align: "right",
      render: (_value, row) => {
        const position = items.findIndex((item) => item.id === row.id);
        return (
          <Space size={2}>
            {/* Two buttons rather than a drag handle: a keyboard-only reader
                cannot drag, and the order is the information on this page
                (§65). Disabled at the ends rather than wrapping — wrapping
                sends the top item to the bottom on a mis-click. */}
            <Tooltip title="Move up">
              <Button
                type="text"
                icon={<ArrowUpOutlined />}
                aria-label={`Move ${row.label} up`}
                data-testid={`up-${row.id}`}
                disabled={position <= 0 || arranged.isPending || kind !== "all"}
                onClick={() => arranged.mutate(movedOrder(items, row.id, -1))}
              />
            </Tooltip>
            <Tooltip title="Move down">
              <Button
                type="text"
                icon={<ArrowDownOutlined />}
                aria-label={`Move ${row.label} down`}
                data-testid={`down-${row.id}`}
                disabled={
                  position < 0 ||
                  position >= items.length - 1 ||
                  arranged.isPending ||
                  kind !== "all"
                }
                onClick={() => arranged.mutate(movedOrder(items, row.id, 1))}
              />
            </Tooltip>
            <Tooltip title="Stop keeping this">
              <Button
                type="text"
                icon={<StarFilled />}
                aria-label={`Stop keeping ${row.label}`}
                data-testid={`unstar-${row.id}`}
                loading={removed.isPending && removed.variables === row.id}
                onClick={() => removed.mutate(row.id)}
              />
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  return (
    <Card
      size="small"
      title="Kept"
      className="nu-fav-card"
      data-testid="bookmarks-card"
      extra={
        list && list.kinds.length > 1 ? (
          <Segmented
            size="small"
            className="nx-fd-kinds"
            value={kind}
            onChange={(value) => setKind(String(value))}
            options={[
              { label: `All (${list.total})`, value: "all" },
              ...list.kinds.map((entry) => ({
                label: `${kindLabel(entry.key)} (${entry.count})`,
                value: entry.key,
              })),
            ]}
          />
        ) : null
      }
    >
      {list ? (
        <Text type="secondary" className="nu-fav-capacity" data-testid="capacity">
          {capacityNote(list)}
        </Text>
      ) : null}
      <Table<Bookmark>
        data-testid="bookmarks-table"
        rowKey="id"
        size="small"
        // No sortable columns, deliberately: the order *is* the
        // information, and offering "sort by name" would invite somebody to
        // destroy the arrangement they made.
        dataSource={items}
        columns={bookmarkColumns}
        pagination={false}
        locale={{
          emptyText: (
            <EmptyState title={
                kind === "all"
                  ? "Nothing kept yet. Star a record, a report or a saved search — or keep one of the things you have looked at, below."
                  : `Nothing of that kind kept.`
              } />
          ),
        }}
      />
      {kind !== "all" ? (
        <Text type="secondary" className="nu-fav-note" data-testid="filter-note">
          Showing one kind, so the order cannot be changed here — the
          arrangement is of the whole list.
        </Text>
      ) : null}
    </Card>
  );
}
