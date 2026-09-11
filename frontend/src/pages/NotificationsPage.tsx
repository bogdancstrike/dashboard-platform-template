import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntApp,
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
  notificationsApi,
  type Notification,
  type NotificationPage,
} from "@/api/notifications";
import { EmptyState, NoResults } from "@/components/EmptyState";
import { NotificationDigest } from "@/components/notifications/NotificationDigest";
import { categoryIcon, humanise, severityColor } from "@/components/notifications/presentation";
import { PageHeader } from "@/components/PageHeader";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { absoluteTime, groupByDay, relativeTime } from "@/lib/time";
import { useLive, usePollInterval } from "@/live/LiveProvider";
import { confirmDelete } from "@/lib/confirm";

const { Text } = Typography;

/** Severity → the AntD tag colour that already means it elsewhere. */
function severityTag(severity: string): string {
  return severity === "CRITICAL" ? "red" : severity === "WARNING" ? "orange" : "default";
}

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
/**
 * One notification's read state, changed in a page of them.
 *
 * A pure function so the guess can be tested without a server, and so the
 * *counts* move with it: a row that greys while the header still says "12
 * unread" is a page disagreeing with itself in front of the reader.
 */
export function withReadState(
  page: NotificationPage,
  id: string,
  isRead: boolean,
): NotificationPage {
  const found = page.items.find((item) => item.id === id);
  if (!found || found.is_read === isRead) return page;

  return {
    ...page,
    items: page.items.map((item) =>
      item.id === id
        ? { ...item, is_read: isRead, read_at: isRead ? new Date().toISOString() : null }
        : item,
    ),
    // Never below zero: a guess that produces "-1 unread" is worse than one
    // that is briefly stale.
    unread: Math.max(0, page.unread + (isRead ? -1 : 1)),
  };
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
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

  /**
   * Read and unread, applied at once and reconciled afterwards (§73).
   *
   * The second place in the platform where optimism is right, and for the
   * same reasons the board's drag is: the outcome is *certain* (nothing can
   * refuse marking your own notification read), it is trivially reversible,
   * and the reader does it forty times in a row. Waiting for a round trip
   * before greying the row makes a list of forty feel broken — and the whole
   * point of the row is that it stops asking for attention.
   *
   * A confirmed write is still the default everywhere else. Optimism is only
   * honest where a refusal is not a real possibility; a form that guessed
   * would be telling the reader their record was saved.
   */
  const setRead = useMutation({
    mutationFn: ({ id, isRead }: { id: string; isRead: boolean }) =>
      notificationsApi.setRead(id, isRead),
    onMutate: async ({ id, isRead }) => {
      // Cancelled first, or an in-flight list can land *after* the guess and
      // undo it — which reads as the click having been ignored.
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const snapshot = queryClient.getQueriesData<NotificationPage>({
        queryKey: ["notifications", "list"],
      });
      queryClient.setQueriesData<NotificationPage>(
        { queryKey: ["notifications", "list"] },
        (current) => (current ? withReadState(current, id, isRead) : current),
      );
      return { snapshot };
    },
    onError: (error, _variables, context) => {
      // Put it back, and say so: a row that silently returns to unread is a
      // click the reader will make again.
      for (const [key, value] of context?.snapshot ?? []) {
        queryClient.setQueryData(key, value);
      }
      message.error(
        error instanceof ApiError ? error.message : "That notification could not be updated.",
      );
    },
    // Either way the server is the authority on the counts, which are over
    // the whole set rather than the page.
    onSettled: invalidate,
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
  // Memoised because the day grouping below depends on it, and a fresh array
  // identity every render would regroup the feed on every keystroke.
  const items = useMemo(() => listing.data?.items ?? [], [listing.data]);
  const total = listing.data?.total ?? 0;

  /**
   * Rows under the day they arrived on.
   *
   * Grouping is a *presentation* of the order the server already returned —
   * newest first — not a re-sort, so a day header can never appear twice and
   * the page cannot disagree with the pager about what is on it.
   */
  const days = useMemo(() => groupByDay(items, (item) => item.created_at), [items]);

  /** Which digest tile, if any, describes the filter currently applied. */
  const activeTile =
    read !== "unread"
      ? null
      : severities.includes("CRITICAL")
        ? "critical"
        : categories.includes("APPROVAL") && categories.includes("ASSIGNMENT")
          ? "needs-you"
          : categories.length === 0 && severities.length === 0
            ? "unread"
            : null;

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

      <NotificationDigest
        counts={listing.data}
        active={activeTile}
        onFilter={(filter) => set({ ...filter, group_key: null, page: null })}
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
            options={(listing.data?.categories ?? []).map((value) => ({ value, label: humanise(value) }))}
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
            options={(listing.data?.severities ?? []).map((value) => ({ value, label: humanise(value) }))}
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
            <Button onClick={() => void listing.refetch()}>
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
          <div className="nu-notice-days">
            {days.map((day) => (
              <section key={day.label} aria-label={day.label}>
                <h3 className="nu-notice-day">
                  <span>{day.label}</span>
                  <span className="nu-notice-day-count">{day.items.length}</span>
                </h3>
                <ul className="nu-notice-list" aria-label="Notifications" aria-live="polite">
                  {day.items.map((item) => (
                    <li key={item.id}>
                      <article
                        className={`nu-notice${item.is_read ? "" : " nu-notice--unread"}`}
                        data-testid="notification-row"
                      >
                        {/* The severity is the tint and the category is the
                            glyph: two channels, so a reader who cannot
                            separate the colours still reads the kind. */}
                        <span
                          className="nu-notice-icon"
                          style={{
                            color: severityColor(item.severity),
                            background: `color-mix(in srgb, ${severityColor(item.severity)} 14%, transparent)`,
                          }}
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
                            {item.severity !== "INFO" && (
                              <Tag color={severityTag(item.severity)} bordered={false}>
                                {humanise(item.severity)}
                              </Tag>
                            )}
                            {grouped && (item.group_count ?? 1) > 1 && (
                              <Tooltip title={`${item.group_count} similar notifications`}>
                                <Tag
                                  data-testid="group-count"
                                  bordered={false}
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

                          {item.body && <p className="nu-notice-text">{item.body}</p>}

                          {/* The kind on the left, when it arrived on the
                              right. A row whose every fact huddles at the
                              left edge leaves the other half of a wide page
                              blank — and the time is what a reader scans a
                              list of notifications *by*, so the right edge is
                              where it belongs. */}
                          <div className="nu-notice-meta">
                            <span className="nu-notice-meta-kind">
                              <span className="nu-notice-chip">{humanise(item.category)}</span>
                              {item.actor_label && <span>{item.actor_label}</span>}
                              {item.link && (
                                <span className="nu-notice-link">Opens the record</span>
                              )}
                            </span>
                            <span title={absoluteTime(item.created_at)}>
                              {relativeTime(item.created_at)}
                            </span>
                          </div>
                        </div>

                        <Space size={2} className="nu-notice-actions">
                          {grouped && (item.group_count ?? 1) > 1 && item.group_key ? (
                            <Tooltip title="Mark this group read">
                              <Button
                                type="text"
                                icon={<CheckOutlined />}
                                aria-label={`Mark the ${item.title} group read`}
                                onClick={() =>
                                  markAll.mutate({ group_key: item.group_key ?? undefined })
                                }
                              />
                            </Tooltip>
                          ) : (
                            <Tooltip title={item.is_read ? "Mark unread" : "Mark read"}>
                              <Button
                                type="text"
                                icon={item.is_read ? <UndoOutlined /> : <CheckOutlined />}
                                aria-label={`Mark ${item.title} as ${item.is_read ? "unread" : "read"}`}
                                onClick={() =>
                                  setRead.mutate({ id: item.id, isRead: !item.is_read })
                                }
                              />
                            </Tooltip>
                          )}
                          <Tooltip title="Delete">
                            <Button
                              type="text"
                              icon={<DeleteOutlined />}
                              aria-label={`Delete ${item.title}`}
                              onClick={() =>
                                confirmDelete(modal, {
                                  what: item.title,
                                  consequence:
                                    "It goes from the notification centre for good. Whatever it was telling you about is unaffected.",
                                  onOk: () => remove.mutateAsync(item.id),
                                })
                              }
                            />
                          </Tooltip>
                        </Space>
                      </article>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
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
