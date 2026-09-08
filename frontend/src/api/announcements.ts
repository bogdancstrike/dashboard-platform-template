import { api } from "./client";

/**
 * Announcements — the platform talking to the people using it (§17, §34).
 *
 * Deliberately not the notifications client. A notification is one person's:
 * addressed, read once, gone. An announcement is a *notice* — written once for
 * many readers, true for a window, and whether a given person has seen it is a
 * fact about that person. See `services/announcements.py`.
 */

/** One notice, with this reader's side of it attached. */
export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: string;
  category_label: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  status: "DRAFT" | "SCHEDULED" | "PUBLISHED" | "ARCHIVED";
  /**
   * Derived on the server from the window, never stored.
   *
   * A status swept to "expired" by a job is wrong between sweeps, and the
   * sweep is the thing nobody notices has stopped.
   */
  is_live: boolean;
  is_expired: boolean;
  is_scheduled: boolean;
  is_pinned: boolean;
  publish_at: string | null;
  expires_at: string | null;
  /** Empty means everybody. Role codes, never a list of people. */
  audience_roles: string[];
  requires_acknowledgement: boolean;
  link: string | null;
  author: { id: string | null; name: string | null; initials: string | null };
  created_at: string | null;
  updated_at: string | null;
  /** This reader's receipt. `null` until they have seen it. */
  read_at: string | null;
  acknowledged_at: string | null;
  /** How far it got. Only on the author's paths. */
  reach?: { read: number; acknowledged: number };
}

export interface AnnouncementCategory {
  key: string;
  label: string;
  count: number;
}

export interface AnnouncementFeed {
  items: Announcement[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  /** Counts over the whole live set, not the page (§71). */
  categories: AnnouncementCategory[];
  unread: number;
  can_manage: boolean;
  category: string;
  include_expired: boolean;
}

export interface AnnouncementDrafts {
  items: Announcement[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  statuses: string[];
  status: string;
  can_manage: boolean;
}

export interface AnnouncementInput {
  title: string;
  body?: string;
  category?: string;
  severity?: string;
  status?: string;
  publish_at?: string | null;
  expires_at?: string | null;
  audience_roles?: string[];
  requires_acknowledgement?: boolean;
  is_pinned?: boolean;
  link?: string | null;
}

/**
 * The query string for a feed request.
 *
 * Typed to the primitives it actually receives rather than `unknown`: an
 * `unknown` here stringifies an object to `[object Object]` and sends it, which
 * is a filter the server would reject for a reason nobody could read from the
 * call site.
 */
function query(params: Record<string, string | number | boolean | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "" && value !== false) search.set(key, String(value));
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : "";
}

export const announcementsApi = {
  feed: (
    params: { category?: string; include_expired?: boolean; unread?: boolean; page?: number } = {},
    signal?: AbortSignal,
  ) => api.get<AnnouncementFeed>(`/api/announcements${query(params)}`, { signal }),

  drafts: (params: { status?: string; page?: number } = {}, signal?: AbortSignal) =>
    api.get<AnnouncementDrafts>(`/api/announcements/drafts${query(params)}`, { signal }),

  get: (id: string, signal?: AbortSignal) =>
    api.get<Announcement>(`/api/announcements/${id}`, { signal }),

  create: (input: AnnouncementInput) =>
    api.post<Announcement>("/api/announcements", input),

  update: (id: string, input: Partial<AnnouncementInput>) =>
    api.put<Announcement>(`/api/announcements/${id}`, input),

  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/api/announcements/${id}`),

  /**
   * Record that this reader has seen — or agreed to — a notice.
   *
   * Idempotent on the server, which is what lets a page mark on render without
   * having to remember whether it already did.
   */
  mark: (id: string, acknowledged = false) =>
    api.post<Announcement>(`/api/announcements/${id}/receipt`, { acknowledged }),
};
