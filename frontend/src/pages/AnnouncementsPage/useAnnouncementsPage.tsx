/** What the page reads, what it keeps in the address, and what it derives. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { announcementsApi, type Announcement } from "@/api/announcements";
import { ApiError } from "@/api/client";
import { usePageCommands } from "@/commands/CommandContext";
import { queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

/** The page's state, queries and actions. */
export function useAnnouncementsPage() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { message, modal } = AntApp.useApp();
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);

  const view = params.get("view") === "manage" ? "manage" : "read";
  const category = params.get("category") ?? "";
  const includeExpired = params.get("history") === "1";
  const status = params.get("status") ?? "";

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => applyParamChanges(current, changes),
      // The board's tabs and categories are places; back returns through them.
      { replace: !("view" in changes || "category" in changes || "history" in changes) },
    );

  const feed = useQuery({
    queryKey: queryKeys.announcements(category, includeExpired),
    queryFn: ({ signal }) =>
      announcementsApi.feed({ category, include_expired: includeExpired }, signal),
  });

  const drafts = useQuery({
    queryKey: queryKeys.announcementDrafts(status),
    queryFn: ({ signal }) => announcementsApi.drafts({ status }, signal),
    enabled: view === "manage" && (feed.data?.can_manage ?? false),
  });

  const canManage = feed.data?.can_manage ?? false;

  const mark = useMutation({
    mutationFn: ({ id, acknowledged }: { id: string; acknowledged: boolean }) =>
      announcementsApi.mark(id, acknowledged),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: queryKeys.announcements() }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => announcementsApi.remove(id),
    onSuccess: () => {
      message.success("Announcement withdrawn");
      void queryClient.invalidateQueries({ queryKey: queryKeys.announcements() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.announcementDrafts() });
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That could not be withdrawn."),
  });

  const items = useMemo(() => feed.data?.items ?? [], [feed.data]);

  /**
   * Mark what is on screen as read, once.
   *
   * Honest rather than clever: these notices *were* shown. The request is
   * idempotent on the server, so this needs no memory of what it has already
   * sent — and it deliberately does not acknowledge anything, because agreeing
   * to a policy is a decision and not a side effect of scrolling.
   */
  useEffect(() => {
    if (view !== "read") return;
    for (const item of items) {
      if (item.read_at === null) mark.mutate({ id: item.id, acknowledged: false });
    }
    // `items` only: re-running when the mutation object changes identity would
    // send the same marks again on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, view]);

  usePageCommands("announcements", [
    {
      id: "announcements.new",
      label: "Write an announcement",
      keywords: "notice publish broadcast",
      run: () => {
        set({ view: "manage" });
        setEditing("new");
      },
    },
    {
      id: "announcements.history",
      label: "Show announcements that have expired",
      keywords: "past history old",
      run: () => set({ view: null, history: "1" }),
    },
  ]);

  return {
    queryClient,
    message,
    modal,
    editing,
    setEditing,
    view,
    category,
    includeExpired,
    status,
    set,
    feed,
    drafts,
    canManage,
    mark,
    remove,
    items,
  };
}

export type AnnouncementsPageData = ReturnType<typeof useAnnouncementsPage>;
