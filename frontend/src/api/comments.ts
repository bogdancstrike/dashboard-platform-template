import { api } from "./client";

/**
 * Comments on any record (§36).
 *
 * Polymorphic on the wire as well as in the table: one endpoint, addressed by
 * `resource_type` and `resource_id`, so a page that wants a conversation gets
 * one without a second client or a second set of rules.
 */
export interface RecordComment {
  id: string;
  resource_type: string;
  resource_id: string;
  parent_id: string | null;
  body: string;
  author: {
    id: string;
    name: string;
    avatar_url: string | null;
    job_title: string | null;
  };
  /** User ids named with `@`, resolved by the server when it was written. */
  mentions: string[];
  is_internal: boolean;
  is_pinned: boolean;
  /** Set when the body was changed, so the page can say so. */
  edited_at: string | null;
  created_at: string;
  /** Whether this reader may change it — the author, and only them. */
  can_edit: boolean;
}

export interface CommentThread {
  items: RecordComment[];
  total: number;
  resource_type: string;
  resource_id: string;
  /** Whether this reader may add to it, so the composer is shown or explained. */
  can_comment: boolean;
}

export const commentsApi = {
  list: (resourceType: string, resourceId: string, signal?: AbortSignal) =>
    api.get<CommentThread>("/api/comments", {
      params: { resource_type: resourceType, resource_id: resourceId },
      signal,
    }),
  create: (input: {
    resource_type: string;
    resource_id: string;
    body: string;
    parent_id?: string;
  }) => api.post<RecordComment>("/api/comments", input),
  update: (id: string, body: string) => api.put<RecordComment>(`/api/comments/${id}`, { body }),
  remove: (id: string) => api.delete<{ deleted: boolean; id: string }>(`/api/comments/${id}`),
};
