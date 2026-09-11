/**
 * `/favorites` — the things you kept, and the things you happened to visit (§38, §39).
 *
 * Six decisions worth the reader's attention.
 *
 * **Two lists, kept apart.** Bookmarks are a decision; recents are a
 * by-product. Merging them would make the list somebody curated
 * indistinguishable from the list that accumulated, and the whole point of a
 * shortcut bar is that everything in it was put there on purpose.
 *
 * **The bookmark list is arranged, not sorted.** No column headers to click:
 * the order *is* the information, and offering "sort by name" would invite
 * somebody to destroy the arrangement they made. Moving one is two buttons,
 * because a keyboard-only reader cannot drag (§65) — and the whole order goes
 * to the server in one call, so two moves cannot fight over one position.
 *
 * **A bookmark opens what it points at, and nothing else.** It carries a
 * stored in-app route, so it keeps working after a rename and after a router
 * change for new records only. There is no "edit": a name typed here would be
 * a second name for the same thing.
 *
 * **Recents offer a star, and that is the only thing they offer.** The row
 * already says whether it is bookmarked, so no request is needed to find out —
 * and starring a recent is how most bookmarks are actually made, which is why
 * it is on the row rather than behind a menu.
 *
 * **Clearing the trail is all-or-nothing, and says so.** Removing one entry
 * from a trail leaves a misleading trail. The confirmation also says the
 * bookmarks survive, because "clear" beside two lists is a frightening word.
 *
 * **Both lists say what would be here.** An empty bookmark list explains how
 * one is made rather than saying "no data" — that is the state a new account
 * is in, and it is the one worth writing for.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App as AntApp,
  Button,
  Card,
  Popconfirm,
  Segmented,
  Skeleton,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  favoritesApi,
  type Bookmark,
  type BookmarkList,
  type RecentVisit,
} from "@/api/favorites";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { errorText } from "@/lib/errors";
import { formatNumber } from "@/lib/formats";
import { absoluteTime, relativeTime } from "@/lib/time";
import { EmptyState } from "@/components/EmptyState";

const { Text } = Typography;

/**
 * What a resource type is called in a sentence.
 *
 * Derived from the type itself rather than from a lookup table, because the
 * bookmarkable types come from the platform's registry and a hand-kept map
 * would be missing whichever one was added last. `saved_search` becomes
 * "Saved search" — which is all a label has to do.
 */
export function kindLabel(resourceType: string): string {
  const spaced = resourceType.replace(/_/g, " ");
  return spaced.slice(0, 1).toUpperCase() + spaced.slice(1);
}

/**
 * The order a move produces, as ids.
 *
 * Pure so it can be asserted directly, and returning the *whole* order rather
 * than a pair of positions: the server takes one list, because applying a drag
 * as a series of single moves is how two moves end up fighting over one
 * position. A move off either end returns the order unchanged rather than
 * wrapping — wrapping would send the top item to the bottom on a mis-click.
 */
export function movedOrder(items: Bookmark[], id: string, direction: -1 | 1): string[] {
  const ids = items.map((item) => item.id);
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** How full the shortcut bar is, in words rather than a fraction. */
export function capacityNote(list: BookmarkList): string {
  if (list.total === 0) return "Nothing kept yet.";
  const kinds = list.kinds.length;
  const spread =
    kinds === 1
      ? `all of one kind`
      : `across ${kinds} kinds`;
  if (list.total >= list.maximum) {
    return `${formatNumber(list.total)} kept ${spread} — that is the limit. Remove one to keep another.`;
  }
  return `${formatNumber(list.total)} kept ${spread}. Up to ${formatNumber(list.maximum)}.`;
}

export default function FavoritesPage() {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [kind, setKind] = useState<string>("all");

  const bookmarks = useQuery({
    queryKey: ["favorites", "list"],
    queryFn: ({ signal }) => favoritesApi.list(signal),
  });
  const recents = useQuery({
    queryKey: ["favorites", "recents"],
    queryFn: ({ signal }) => favoritesApi.recents(signal),
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["favorites"] });
  };

  const removed = useMutation({
    mutationFn: (id: string) => favoritesApi.remove(id),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "change your favourites" }));
    },
  });

  const arranged = useMutation({
    mutationFn: (order: string[]) => favoritesApi.arrange(order),
    onSuccess: async () => {
      await refresh();
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "rearrange your favourites" }));
    },
  });

  const starred = useMutation({
    mutationFn: (row: RecentVisit) =>
      row.is_favorite
        ? Promise.reject(new Error("unstar from the list above"))
        : favoritesApi.add({
            resource_type: row.resource_type,
            resource_id: row.resource_id,
            label: row.label,
            url: row.url,
            ...(row.icon ? { icon: row.icon } : {}),
          }),
    onSuccess: async () => {
      await refresh();
      message.success("Kept.");
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "keep that" }));
    },
  });

  const cleared = useMutation({
    mutationFn: () => favoritesApi.clearRecents(),
    onSuccess: async (answer) => {
      await refresh();
      message.success(
        answer.cleared === 0
          ? "There was nothing to forget."
          : `${formatNumber(answer.cleared)} forgotten. Your favourites are untouched.`,
      );
    },
    onError: (error: unknown) => {
      message.error(errorText(error, { action: "clear that" }));
    },
  });

  usePageCommands("favorites", [
    {
      id: "favorites.clear-recents",
      label: "Forget what I have looked at",
      keywords: "recents clear history forget visited",
      run: () => cleared.mutate(),
    },
    {
      id: "favorites.bookmarks",
      label: "Show only what I starred",
      keywords: "bookmarks starred favorites kept mine",
      run: () => setKind("all"),
    },
    {
      id: "favorites.refresh",
      label: "Check for anything new",
      keywords: "refresh reload update recents",
      run: () => {
        void bookmarks.refetch();
        void recents.refetch();
      },
    },
    {
      id: "favorites.explore",
      label: "Find something to star",
      keywords: "explore records search browse datasets",
      run: () => navigate("/explore"),
    },
  ]);

  const list = bookmarks.data;
  const items = (list?.items ?? []).filter(
    (item) => kind === "all" || item.resource_type === kind,
  );

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
          <Text type="secondary" className="nu-fav-kind">
            {kindLabel(row.resource_type)}
          </Text>
        </div>
      ),
    },
    {
      title: "Kept",
      dataIndex: "added_at",
      width: 120,
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

  const recentColumns: ColumnsType<RecentVisit> = [
    {
      title: "What",
      dataIndex: "label",
      render: (value: string, row) => (
        <div className="nu-fav-what">
          <Link to={row.url} className="nu-fav-link">
            {value}
          </Link>
          <Text type="secondary" className="nu-fav-kind">
            {kindLabel(row.resource_type)}
          </Text>
        </div>
      ),
    },
    {
      title: "Visits",
      dataIndex: "visit_count",
      width: 90,
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

  if (bookmarks.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />;

  return (
    <div className="nu-fav">
      <PageHeader
        title="Favorites"
        subtitle="The things you keep, and the things you have looked at lately."
        actions={
          <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>
            Refresh
          </Button>
        }
      />

      <Card
        size="small"
        title="Kept"
        className="nu-fav-card"
        data-testid="bookmarks-card"
        extra={
          list && list.kinds.length > 1 ? (
            <Segmented
              size="small"
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
    </div>
  );
}
