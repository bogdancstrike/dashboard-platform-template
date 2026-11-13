/** What the page reads, what it keeps in the address, and what it derives. */

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { activityApi } from "@/api/activity";
import { explorerApi } from "@/api/explorer";
import { usePageCommands } from "@/commands/CommandContext";
import { groupByDay } from "@/lib/time";
import { STALE, queryKeys } from "@/lib/queryKeys";
import { applyParamChanges } from "@/hooks/useUrlState";

import { summarise } from "./model";

/** The page's state, queries and actions. */
export function useActivityPage() {
  const [params, setParams] = useSearchParams();

  const kind = params.get("kind") ?? "";
  const resourceType = params.get("resource_type") ?? "";
  const actorId = params.get("actor_id") ?? "";
  const period = params.get("period") ?? "last_30_days";
  const page = Number(params.get("page") ?? 1);

  const set = (changes: Record<string, string | null>) =>
    setParams(
      (current) => {
        const next = applyParamChanges(current, changes);
        // Any change to the question starts at the beginning: page 3 of a
        // different question is not a place anybody asked to be.
        if (!("page" in changes)) next.delete("page");
        return next;
      },
      // Narrowing to a kind or a person is a place back returns from; the
      // period and paging are tweaks to the same place.
      { replace: !("kind" in changes || "actor_id" in changes) },
    );

  const feed = useQuery({
    queryKey: queryKeys.activity(kind, resourceType, actorId, period, page),
    queryFn: ({ signal }) =>
      activityApi.feed(
        { kind, resource_type: resourceType, actor_id: actorId, period, page },
        signal,
      ),
    placeholderData: (previous) => previous,
  });

  // The datasets a reader may filter by come from the explorer's catalogue,
  // which is generated from the same declarations the feed validates against —
  // so this select cannot offer a value the endpoint would refuse.
  const catalogue = useQuery({
    queryKey: queryKeys.explorerCatalogue(),
    queryFn: ({ signal }) => explorerApi.catalogue(signal),
    staleTime: STALE.long,
  });

  /**
   * The context beside the feed: the newest two hundred entries for the same
   * question, whatever kind is chosen. A sample rather than a census — the
   * panels say so when the period holds more — and it is the same endpoint,
   * so a number here cannot disagree with a row in the feed.
   */
  const context = useQuery({
    queryKey: queryKeys.activityContext(resourceType, actorId, period),
    queryFn: ({ signal }) =>
      activityApi.feed(
        { resource_type: resourceType, actor_id: actorId, period, page_size: 200 },
        signal,
      ),
    staleTime: STALE.short,
  });
  const summary = useMemo(() => summarise(context.data?.items ?? []), [context.data]);

  // Memoised, because the grouping below depends on it: a fresh `[]` on every
  // render would re-bucket the feed on every keystroke elsewhere on the page.
  const items = useMemo(() => feed.data?.items ?? [], [feed.data]);
  const days = useMemo(() => groupByDay(items, (item) => item.occurred_at), [items]);

  usePageCommands("activity", [
    {
      id: "activity.refresh",
      label: "Refresh the activity feed",
      keywords: "reload again",
      run: () => void feed.refetch(),
    },
    {
      id: "activity.security",
      label: "Show sign-ins and security events",
      keywords: "login impersonate",
      run: () => set({ kind: "SECURITY" }),
    },
    {
      id: "activity.clear",
      label: "Clear the activity filters",
      keywords: "reset all",
      run: () => setParams(new URLSearchParams(), { replace: true }),
    },
  ]);

  const kinds = feed.data?.kinds ?? [];
  const matched = feed.data?.matched ?? 0;

  return {
    setParams,
    kind,
    resourceType,
    actorId,
    period,
    page,
    set,
    feed,
    catalogue,
    context,
    summary,
    items,
    days,
    kinds,
    matched,
  };
}

export type ActivityPageData = ReturnType<typeof useActivityPage>;
