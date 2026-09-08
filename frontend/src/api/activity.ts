import { api } from "./client";

/**
 * The activity feed (§35).
 *
 * Deliberately not the audit client: `/api/audit/timeline` answers "what was
 * done to *this record*, exactly" for a detail page, and the ledger behind
 * `audit.view` is evidence. This answers "what has been going on" across
 * everything the reader may see, and needs only `records.view`.
 */

/** One thing that happened. */
export interface ActivityEntry {
  id: string;
  occurred_at: string;
  kind: string;
  kind_label: string;
  action: string;
  /**
   * Who did it.
   *
   * `initials` comes from the server so that one rule decides them
   * (`core/naming`) — it had been written twice there, and the two copies
   * disagreed about a middle name.
   */
  actor: { id: string | null; name: string | null; initials: string | null };
  resource_type: string | null;
  resource_id: string | null;
  resource_label: string | null;
  /**
   * Where this entry's subject lives.
   *
   * From the resource declaration on the server, not assembled here — a feed
   * that built its own links would be a second router.
   */
  resource_path: string | null;
  summary: string | null;
  /** Which fields the change touched, when the entry was a change. */
  changed: string[];
}

/** One chip of the strip: a kind, its name, and how many there are. */
export interface ActivityKind {
  key: string;
  label: string;
  count: number;
}

export interface ActivityFeed {
  items: ActivityEntry[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  /**
   * The counts, over the whole match rather than the page.
   *
   * Unchanged by the chosen kind on purpose: a strip whose numbers move when
   * you use it cannot be used to compare.
   */
  kinds: ActivityKind[];
  kind: string;
  resource_type: string;
  actor_id: string;
  period: string;
  /** Every entry the filters match, whichever kind is chosen. */
  matched: number;
}

export interface ActivityQuery {
  kind?: string;
  resource_type?: string;
  actor_id?: string;
  period?: string;
  page?: number;
  page_size?: number;
}

export const activityApi = {
  feed: (query: ActivityQuery = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    const suffix = params.toString();
    return api.get<ActivityFeed>(`/api/activity${suffix ? `?${suffix}` : ""}`, { signal });
  },
};
