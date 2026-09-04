import { api } from "./client";

/** The categories the centre filters by. Free strings are still accepted. */
export const NOTIFICATION_CATEGORIES = [
  "MENTION",
  "ASSIGNMENT",
  "APPROVAL",
  "SYSTEM",
  "SECURITY",
  "REPORT",
] as const;

export const NOTIFICATION_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export interface Notification {
  id: string;
  category: string;
  severity: string;
  title: string;
  body: string | null;
  icon: string | null;
  is_read: boolean;
  read_at: string | null;
  link: string | null;
  resource_type: string | null;
  resource_id: string | null;
  actor_id: string | null;
  actor_label: string | null;
  group_key: string | null;
  created_at: string;
  /** Only in the grouped view: how many rows this line stands for. */
  group_count?: number;
  group_unread?: number;
}

export interface NotificationCounts {
  unread: number;
  by_category: Record<string, number>;
}

export interface NotificationPage extends NotificationCounts {
  items: Notification[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sort: string;
  order: string;
  grouped: boolean;
}

export interface NotificationQuery {
  page?: number;
  page_size?: number;
  /** `all` · `read` · `unread`. */
  read?: string;
  category?: string[] | string;
  severity?: string[] | string;
  group_key?: string;
  group?: boolean;
  q?: string;
}

export const notificationsApi = {
  list: (params: NotificationQuery, signal?: AbortSignal) =>
    api.get<NotificationPage>("/notifications", {
      // `group` is only sent when it is on: an explicit `false` would still be
      // serialised, and the backend reads any present value as a flag.
      params: { ...params, group: params.group ? "true" : undefined },
      signal,
    }),

  counts: (signal?: AbortSignal) =>
    api.get<NotificationCounts>("/notifications/counts", { signal }),

  setRead: (id: string, isRead: boolean) =>
    api.put<Notification>(`/notifications/${id}`, { is_read: isRead }),

  remove: (id: string) => api.delete<{ deleted: string }>(`/notifications/${id}`),

  /** Mark everything, one category, or one collapsed group. */
  markAllRead: (scope: { category?: string; group_key?: string } = {}) =>
    api.post<{ marked: number; read_at: string }>("/notifications/read-all", scope),
};
