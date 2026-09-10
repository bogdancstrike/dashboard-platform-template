/**
 * Starring anything, from wherever it is (§38).
 *
 * `/favorites` reads one store, and everything that stars writes to it — a
 * report, a saved search, and now any *record* the reader is looking at. That
 * store is the whole point: before it there were two, and a reader could star
 * a saved search, be told by the drawer's own tooltip that it had gone to
 * their favourites, and find nothing there.
 *
 * Three decisions worth stating.
 *
 * **One request for the whole page, not one per row.** A table of twenty-five
 * rows asking "am I starred" twenty-five times is twenty-five round trips for
 * a glyph. The bookmark list is small and bounded by design, so it is fetched
 * once under the key `/favorites` already uses and every star reads from it.
 *
 * **The star is optimistic and reconciled.** The server answers a star with
 * the *whole list*, which is what makes the count on `/favorites` right — so
 * the cache is replaced from the answer rather than patched. In between, the
 * glyph fills immediately: a star that waits for a round trip feels broken
 * even when it works.
 *
 * **A bookmark stores the address, and so does this.** The label and the URL
 * are copies, refreshed whenever something is re-starred, because a bookmark
 * has to keep working when a record is renamed *and* when a route's shape
 * changes for new records only. Deriving the link at read time would be a
 * second router.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Button, Tooltip } from "antd";
import { StarFilled, StarOutlined } from "@ant-design/icons";
import type { MouseEvent } from "react";

import { ApiError } from "@/api/client";
import { favoritesApi, type BookmarkList } from "@/api/favorites";

/** What the whole page needs to know about what this reader has starred. */
export function useFavorites() {
  const bookmarks = useQuery({
    queryKey: ["favorites"],
    queryFn: ({ signal }) => favoritesApi.list(signal),
    staleTime: 60_000,
  });

  const byKey = new Map(
    (bookmarks.data?.items ?? []).map((item) => [
      `${item.resource_type}:${item.resource_id}`,
      item.id,
    ]),
  );

  return {
    /** The bookmark's own id when it is starred, otherwise nothing. */
    starOf: (resourceType: string, recordId: string) =>
      byKey.get(`${resourceType}:${recordId}`),
    ready: !bookmarks.isLoading,
    full: (bookmarks.data?.total ?? 0) >= (bookmarks.data?.maximum ?? Infinity),
  };
}

export function FavoriteStar({
  resourceType,
  recordId,
  label,
  url,
  size = "small",
}: {
  resourceType: string;
  recordId: string;
  /** What to call it in the favourites list. A copy, refreshed on re-star. */
  label: string;
  /** Where it lives. Stored, so a bookmark survives a route change (§38). */
  url: string;
  size?: "small" | "middle";
}) {
  const { message } = AntApp.useApp();
  const queryClient = useQueryClient();
  const { starOf, full } = useFavorites();
  const existing = starOf(resourceType, recordId);
  const starred = Boolean(existing);

  const toggle = useMutation({
    mutationFn: () =>
      existing
        ? favoritesApi.remove(existing)
        : favoritesApi.add({ resource_type: resourceType, resource_id: recordId, label, url }),
    // The answer *is* the list — that is what keeps `/favorites`' own count
    // right without a second request — so the cache is replaced rather than
    // invalidated and re-fetched.
    onSuccess: (list: BookmarkList) => {
      queryClient.setQueryData(["favorites"], list);
      void queryClient.invalidateQueries({ queryKey: ["recents"] });
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : "That star was not saved."),
    onMutate: () => {
      // Optimistic: fill the glyph now. `onError` puts it back by refetching,
      // which is the honest behaviour for a write that can be refused.
      const previous = queryClient.getQueryData<BookmarkList>(["favorites"]);
      if (!previous) return;
      queryClient.setQueryData<BookmarkList>(["favorites"], {
        ...previous,
        items: existing
          ? previous.items.filter((item) => item.id !== existing)
          : [
              ...previous.items,
              {
                id: `pending:${recordId}`,
                resource_type: resourceType,
                resource_id: recordId,
                label,
                url,
                icon: null,
                position: previous.items.length,
                added_at: null,
              },
            ],
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["favorites"] }),
  });

  // Refused with the reason rather than hidden: a limit somebody meets once is
  // a limit worth explaining (§76).
  const blocked = !starred && full;

  return (
    <Tooltip
      title={
        blocked
          ? "Your favourites are full — unstar something first"
          : starred
            ? "Remove from favourites"
            : "Add to favourites"
      }
    >
      <Button
        type="text"
        size={size}
        className="nu-fav-star"
        disabled={blocked}
        loading={toggle.isPending}
        aria-pressed={starred}
        aria-label={starred ? `Unstar ${label}` : `Star ${label}`}
        data-testid={`star-${recordId}`}
        icon={starred ? <StarFilled className="nu-fav-star-on" /> : <StarOutlined />}
        onClick={(event: MouseEvent) => {
          // A row is a click target of its own — in the explorer it opens the
          // preview — and starring is not opening.
          event.stopPropagation();
          toggle.mutate();
        }}
      />
    </Tooltip>
  );
}
