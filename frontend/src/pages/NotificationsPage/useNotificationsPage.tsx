/** What the page reads, what it keeps in the address, and what it derives. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ApiError } from "@/api/client";
import { notificationsApi, type Notification, type NotificationPage } from "@/api/notifications";
import { usePageCommands } from "@/commands/CommandContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { groupByDay } from "@/lib/time";
import { useLive, usePollInterval } from "@/live/LiveProvider";
import { queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

import { withReadState } from "./model";

/** The page's state, queries and actions. */
export function useNotificationsPage() {
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
  const categories = useMemo(() => categoryParam.split(",").filter(Boolean), [categoryParam]);
  const severities = useMemo(() => severityParam.split(",").filter(Boolean), [severityParam]);
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
    queryKey: queryKeys.notifications("list", query),
    queryFn: ({ signal }) => notificationsApi.list(query, signal),
    refetchInterval,
    placeholderData: (previous) => previous,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications() });

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
      await queryClient.cancelQueries({ queryKey: queryKeys.notifications() });
      const snapshot = queryClient.getQueriesData<NotificationPage>({
        queryKey: queryKeys.notifications("list"),
      });
      queryClient.setQueriesData<NotificationPage>(
        { queryKey: queryKeys.notifications("list") },
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
    setParams((current) => applyParamChanges(current, changes), { replace });
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

  return {
    message,
    modal,
    status,
    read,
    categories,
    severities,
    grouped,
    page,
    pageSize,
    draft,
    setDraft,
    listing,
    setRead,
    remove,
    markAll,
    set,
    filterCount,
    clearFilters,
    unread,
    items,
    total,
    days,
    activeTile,
    openItem,
  };
}

export type NotificationsPageData = ReturnType<typeof useNotificationsPage>;
