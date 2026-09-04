import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Badge,
  Button,
  Card,
  Input,
  Pagination,
  Segmented,
  Select,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  CheckOutlined,
  ClearOutlined,
  DeleteOutlined,
  GroupOutlined,
  UndoOutlined,
} from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  notificationsApi,
  type Notification,
} from "@/api/notifications";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { categoryIcon, humanise, severityColor } from "@/components/notifications/presentation";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { absoluteTime, relativeTime } from "@/lib/time";
import { useLive, usePollInterval } from "@/live/LiveProvider";

const { Text } = Typography;

const READ_STATES = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
];

/**
 * The notification centre (§17).
 *
 * Everything the reader chose is in the URL (§69, §72), so a filtered centre
 * can be pasted to somebody else and back/forward walk the states rather than
 * leaving the page. The list itself is filtered, counted and grouped in
 * PostgreSQL (§71) — a page that groups the twenty-five rows it happens to
 * have downloaded reports "3 of a kind" for something the server would have
 * told it was thirty.
 */
export default function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { status } = useLive();
  const refetchInterval = usePollInterval(45_000);

  const read = params.get("read") ?? "all";
  // Kept as the comma-separated strings the URL and the API both speak, and
  // split for the controls. Two `join(",")` calls inside a dependency array is
  // a new array identity on every render and a query key that never settles.
  const categoryParam = params.get("category") ?? "";
  const severityParam = params.get("severity") ?? "";
  const categories = useMemo(
    () => categoryParam.split(",").filter(Boolean),
    [categoryParam],
  );
  const severities = useMemo(
    () => severityParam.split(",").filter(Boolean),
    [severityParam],
  );
  const grouped = params.get("group") === "1";
  const groupKey = params.get("group_key") ?? "";
  const page = Number(params.get("page") ?? 1) || 1;
  const pageSize = Number(params.get("page_size") ?? 25) || 25;
  const term = params.get("q") ?? "";

  // The box is local so typing is never throttled by a URL write; the URL and
  // the request follow once the reader pauses.
  const [draft, setDraft] = useState(term);
  const debouncedDraft = useDebouncedValue(draft, 280);

  useEffect(() => {
    setDraft(term);
  }, [term]);

  useEffect(() => {
    if (debouncedDraft === term) return;
    set({ q: debouncedDraft || null, page: null });
    // `set` is stable in behaviour but rebuilt each render; the term is what
    // this effect is actually about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedDraft]);

  const query = useMemo(
    () => ({
      read,
      category: categoryParam || undefined,
      severity: severityParam || undefined,
      group: grouped,
      group_key: groupKey || undefined,
      q: term || undefined,
      page,
      page_size: pageSize,
    }),
    [read, categoryParam, severityParam, grouped, groupKey, term, page, pageSize],
  );

  const listing = useQuery({
    queryKey: ["notifications", "list", query],
    queryFn: ({ signal }) => notificationsApi.list(query, signal),
    refetchInterval,
    placeholderData: (previous) => previous,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notifications"] });

  const setRead = useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      notificationsApi.setRead(id, isRead),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => notificationsApi.remove(id),
    onSuccess: invalidate,
  });
  const markAll = useMutation({
    mutationFn: (scope: { category?: string; group_key?: string }) =>
      notificationsApi.markAllRead(scope),
    onSuccess: invalidate,
  });

  const set = (changes: Record<string, string | number | null>, replace = true) => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(changes).forEach(([key, value]) => {
          if (value === null || value === "") next.delete(key);
          else next.set(key, String(value));
        });
        return next;
      },
      { replace },
    );
  };

  const filterCount =
    (read !== "all" ? 1 : 0) +
    categories.length +
    severities.length +
    (term ? 1 : 0) +
    (groupKey ? 1 : 0);

  const clearFilters = () => {
    setParams(grouped ? new URLSearchParams({ group: "1" }) : new URLSearchParams());
  };

  usePageCommands("notifications", [
    {
      id: "notifications.mark-all",
      label: "Mark all notifications as read",
      keywords: "clear unread badge",
      run: () => markAll.mutate({}),
    },
    {
      id: "notifications.unread",
      label: "Show only unread notifications",
      keywords: "filter unread",
      run: () => set({ read: "unread", page: null }),
    },
    {
      id: "notifications.group",
      label: grouped ? "Show every notification separately" : "Group similar notifications",
      keywords: "collapse group key",
      run: () => set({ group: grouped ? null : "1", page: null }),
    },
  ]);

  const unread = listing.data?.unread ?? 0;
  const items = listing.data?.items ?? [];
  const total = listing.data?.total ?? 0;

  const openItem = (item: Notification) => {
    if (!item.is_read) setRead.mutate({ id: item.id, isRead: true });
    if (item.link) navigate(item.link);
  };

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Everything addressed to you — mentions, assignments, approvals, security and system messages."
        tag={
          <Space size={6}>
            <Tag color={unread > 0 ? "blue" : undefined} data-testid="unread-count">
              {unread} unread
            </Tag>
            <Tooltip
              title={
                status === "live"
                  ? "Connected — new notifications arrive without a reload"
                  : "The live channel is unavailable, so this page refreshes on a timer instead"
              }
            >
              <Tag color={status === "live" ? "green" : "default"} data-testid="live-status">
                {status === "live" ? "Live" : "Polling"}
              </Tag>
            </Tooltip>
          </Space>
        }
        actions={
          <>
            <Button
              icon={<GroupOutlined />}
              type={grouped ? "primary" : "default"}
              aria-pressed={grouped}
              onClick={() => set({ group: grouped ? null : "1", page: null })}
            >
              {grouped ? "Grouped" : "Group similar"}
            </Button>
            <Button
              icon={<CheckOutlined />}
              disabled={unread === 0}
              loading={markAll.isPending}
              onClick={() => markAll.mutate({})}
            >
              Mark all read
            </Button>
          </>
        }
      />

      <Card size="small" className="nu-filter-bar">
        <Space wrap size={8} align="center">
          <Segmented
            options={READ_STATES}
            value={read}
            aria-label="Read state"
            onChange={(value) => set({ read: String(value) === "all" ? null : String(value), page: null })}
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="Category"
            style={{ minWidth: 200 }}
            aria-label="Category"
            value={categories}
            options={NOTIFICATION_CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
            onChange={(values: string[]) =>
              set({ category: values.join(",") || null, page: null })
            }
          />
          <Select
            mode="multiple"
            allowClear
            placeholder="Severity"
            style={{ minWidth: 180 }}
            aria-label="Severity"
            value={severities}
            options={NOTIFICATION_SEVERITIES.map((value) => ({ value, label: humanise(value) }))}
            onChange={(values: string[]) =>
              set({ severity: values.join(",") || null, page: null })
            }
          />
          <Input.Search
            allowClear
            placeholder="Search titles and bodies"
            aria-label="Search notifications"
            style={{ width: 260 }}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          {filterCount > 0 && (
            <Button icon={<ClearOutlined />} onClick={clearFilters}>
              Clear {filterCount} filter{filterCount === 1 ? "" : "s"}
            </Button>
          )}
        </Space>
      </Card>

      {listing.isError && (
        <Alert
          type="error"
          showIcon
          className="nu-block"
          message={
            listing.error instanceof ApiError
              ? listing.error.message
              : "Could not load your notifications"
          }
          description={
            listing.error instanceof ApiError ? (
              <Space direction="vertical" size={4}>
                <Text type="secondary">
                  {listing.error.status} {listing.error.code}
                </Text>
                <Text code copyable={{ text: listing.error.correlationId }}>
                  {listing.error.correlationId}
                </Text>
              </Space>
            ) : undefined
          }
          action={
            <Button size="small" onClick={() => void listing.refetch()}>
              Retry
            </Button>
          }
        />
      )}

      <Card size="small" className="nu-block">
        {listing.isLoading ? (
          // A skeleton in the final layout, so the rows do not jump when they
          // arrive under the reader's cursor.
          <Skeleton active title={false} paragraph={{ rows: 8 }} />
        ) : items.length === 0 ? (
          filterCount > 0 ? (
            <NoResults filterCount={filterCount} onClear={clearFilters} />
          ) : (
            <EmptyState
              title="Nothing has needed your attention yet"
              hint="Mentions, assignments, approvals and security notices arrive here as they happen."
            />
          )
        ) : (
          <ul className="nu-notice-list" aria-label="Notifications" aria-live="polite">
            {items.map((item) => (
              <li key={item.id}>
                <article
                  className={`nu-notice${item.is_read ? "" : " nu-notice--unread"}`}
                  data-testid="notification-row"
                >
                  <span
                    className="nu-notice-icon"
                    style={{ color: severityColor(item.severity) }}
                    aria-hidden
                  >
                    {categoryIcon(item.category)}
                  </span>

                  <div className="nu-notice-body">
                    <div className="nu-notice-title">
                      <button
                        type="button"
                        className="nu-notice-open"
                        onClick={() => openItem(item)}
                      >
                        <Text strong={!item.is_read}>{item.title}</Text>
                      </button>
                      {!item.is_read && <Badge status="processing" title="Unread" />}
                      {grouped && (item.group_count ?? 1) > 1 && (
                        <Tooltip title={`${item.group_count} similar notifications`}>
                          <Tag
                            data-testid="group-count"
                            onClick={() =>
                              set({ group: null, group_key: item.group_key, page: null })
                            }
                            style={{ cursor: "pointer" }}
                          >
                            +{(item.group_count ?? 1) - 1} more
                          </Tag>
                        </Tooltip>
                      )}
                    </div>

                    {item.body && (
                      <Text type="secondary" className="nu-notice-text">
                        {item.body}
                      </Text>
                    )}

                    <Space size={6} wrap className="nu-notice-meta">
                      <Tag color={item.severity === "INFO" ? undefined : "default"}>
                        {humanise(item.category)}
                      </Tag>
                      <Text type="secondary" style={{ color: severityColor(item.severity) }}>
                        {humanise(item.severity)}
                      </Text>
                      {item.actor_label && <Text type="secondary">{item.actor_label}</Text>}
                      <Text type="secondary" title={absoluteTime(item.created_at)}>
                        {relativeTime(item.created_at)}
                      </Text>
                    </Space>
                  </div>

                  <Space size={4} className="nu-notice-actions">
                    {grouped && (item.group_count ?? 1) > 1 && item.group_key ? (
                      <Tooltip title="Mark this group read">
                        <Button
                          type="text"
                          size="small"
                          icon={<CheckOutlined />}
                          aria-label={`Mark the ${item.title} group read`}
                          onClick={() => markAll.mutate({ group_key: item.group_key ?? undefined })}
                        />
                      </Tooltip>
                    ) : (
                      <Tooltip title={item.is_read ? "Mark unread" : "Mark read"}>
                        <Button
                          type="text"
                          size="small"
                          icon={item.is_read ? <UndoOutlined /> : <CheckOutlined />}
                          aria-label={`Mark ${item.title} as ${item.is_read ? "unread" : "read"}`}
                          onClick={() => setRead.mutate({ id: item.id, isRead: !item.is_read })}
                        />
                      </Tooltip>
                    )}
                    <Tooltip title="Delete">
                      <Button
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        aria-label={`Delete ${item.title}`}
                        onClick={() => remove.mutate(item.id)}
                      />
                    </Tooltip>
                  </Space>
                </article>
              </li>
            ))}
          </ul>
        )}

        {total > pageSize && (
          <div className="nu-notice-pager">
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              showSizeChanger
              pageSizeOptions={[10, 25, 50, 100]}
              showTotal={(count, range) =>
                `${range[0]}–${range[1]} of ${count.toLocaleString()}${grouped ? " groups" : ""}`
              }
              onChange={(next, size) =>
                set({ page: next === 1 ? null : next, page_size: size === 25 ? null : size })
              }
            />
          </div>
        )}
      </Card>
    </>
  );
}
