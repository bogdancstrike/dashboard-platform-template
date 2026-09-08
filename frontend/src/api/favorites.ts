import { api } from "./client";

/**
 * Bookmarks and recents (§38, §39).
 *
 * Four things worth knowing before reading the types.
 *
 * **One store, whatever was starred.** `Favorite` rows answer "what have I
 * bookmarked" across saved searches, reports, records and anything else
 * addressable. Before this there were two — a boolean on the report and a
 * table nothing read — so a reader could star a saved search, be told by the
 * drawer's own tooltip that it went to their favourites, and find nothing
 * there.
 *
 * **`label` and `url` are copies, refreshed on a re-star.** A bookmark has to
 * keep working when a record is renamed *and* when a route's shape changes for
 * new records only, which is why the server stores the address rather than
 * deriving it. There is no "rename a bookmark": a name typed here would be a
 * second name for the same thing.
 *
 * **Order is an arrangement, not a sort.** A bookmark list is a shortcut bar,
 * so `position` records a decision somebody made and the whole order is sent
 * at once — applying a drag as a series of single moves is how two drags end
 * up fighting over one position.
 *
 * **A recent is not a favourite.** It is a by-product with a visit count and
 * a last-visited moment, it is trimmed rather than paged, and clearing the
 * trail leaves the bookmarks alone. Mixing the two would make the deliberate
 * list indistinguishable from the automatic one.
 *
 * No permission gates any of it: these are your own, and being signed in is
 * the qualification.
 *
 * See `services/favorites.py`.
 */

export interface Bookmark {
  id: string;
  resource_type: string;
  resource_id: string;
  label: string;
  /** An in-app route, stored so it survives a rename and a router change. */
  url: string;
  icon: string | null;
  /** The reader's own arrangement. */
  position: number;
  added_at: string | null;
}

export interface BookmarkList {
  items: Bookmark[];
  total: number;
  maximum: number;
  /** Counts per kind, derived on the server so they cannot disagree with the rows. */
  kinds: Array<{ key: string; count: number }>;
  /** Every type a bookmark may name, from the platform's own registry. */
  bookmarkable: string[];
}

export interface RecentVisit {
  id: string;
  resource_type: string;
  resource_id: string;
  label: string;
  url: string;
  icon: string | null;
  visited_at: string | null;
  /** What separates a place somebody works from one they wandered into once. */
  visit_count: number;
  /** So a recent can offer "star this" without a request per row. */
  is_favorite: boolean;
}

export interface RecentList {
  items: RecentVisit[];
  total: number;
  /** How many are kept at all — recents are trimmed, not paged. */
  kept: number;
}

export interface ClearedRecents extends RecentList {
  cleared: number;
}

/** What a bookmark needs: something to point at, a name and an in-app address. */
export interface NewBookmark {
  resource_type: string;
  resource_id: string;
  label: string;
  url: string;
  icon?: string;
}

export const favoritesApi = {
  list: (signal?: AbortSignal) => api.get<BookmarkList>("/favorites", { signal }),
  add: (input: NewBookmark) => api.post<BookmarkList>("/favorites", input),
  /** Unstar one thing. Answers with the list, because that is what changed. */
  remove: (id: string) => api.delete<BookmarkList>(`/favorites/${id}`),
  /** The whole order at once — see the module note on why. */
  arrange: (order: string[]) => api.put<BookmarkList>("/favorites/order", { order }),
  recents: (signal?: AbortSignal) => api.get<RecentList>("/recents", { signal }),
  visit: (input: NewBookmark) => api.post<RecentList>("/recents", input),
  /** All of it or none: removing one entry from a trail leaves a misleading one. */
  clearRecents: () => api.delete<ClearedRecents>("/recents"),
};
