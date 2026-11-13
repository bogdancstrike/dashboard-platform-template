import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { notificationsApi } from "@/api/notifications";
import { NAV_GROUPS, type NavGroup } from "@/app/navigation";
import { useAuth } from "@/auth/AuthProvider";
import { queryKeys } from "@/lib/queryKeys";
import { usePollInterval } from "@/live/LiveProvider";
import { navItemFlag, useFeatures } from "@/settings/features";

/**
 * The navigation this reader can actually use.
 *
 * Items the reader cannot reach are absent, not disabled (§1, §27): an item is
 * behind its own permission, and its own flag or the flag of the route it opens.
 */
export function useNavGroups(): NavGroup[] {
  const auth = useAuth();
  const features = useFeatures();
  return useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items
          .filter((item) => auth.can(item.permission))
          .filter((item) => {
            const flag = navItemFlag(item);
            return !flag || features(flag);
          }),
      })).filter((group) => group.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auth.can, auth.profile?.features],
  );
}

export type NavCounters = Record<string, number | undefined>;

/** The badge counters that ride along on one poll (§17). */
export function useNavCounters(): NavCounters {
  const badgePoll = usePollInterval(60_000);
  const counts = useQuery({
    queryKey: queryKeys.notifications("counts"),
    queryFn: ({ signal }) => notificationsApi.counts(signal),
    refetchInterval: badgePoll,
  });
  const data = counts.data as
    | { unread?: number; pending_approvals?: number; chat_unread?: number }
    | undefined;
  return {
    unread: data?.unread,
    // The approvals inbox rides on the same poll (Time & decisions).
    pending_approvals: data?.pending_approvals,
    // Unread chat across channels and direct messages (Collaboration).
    chat_unread: data?.chat_unread,
  };
}
