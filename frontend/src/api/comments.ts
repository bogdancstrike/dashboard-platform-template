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
  /** Emoji reactions, with whether this reader is among them (§47). */
  reactions?: Reaction[];
  /** Files sent with the line. */
  attachments?: Attachment[];
  /** How many replies a top-level line has, in a windowed (chat) listing. */
  reply_count?: number;
  last_reply_at?: string | null;
  is_internal: boolean;
  is_pinned: boolean;
  /** Set when the body was changed, so the page can say so. */
  edited_at: string | null;
  created_at: string;
  /** Whether this reader may change it — the author, and only them. */
  can_edit: boolean;
}

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
  /** Who reacted, by name, for the tooltip. */
  people: string[];
}

export interface Attachment {
  id: string;
  name: string;
  size_bytes: number;
  mime_type: string | null;
}

export interface ReadMarker {
  user_id: string;
  name: string;
  avatar_url: string | null;
  last_read_at: string;
}

export interface CommentThread {
  items: RecordComment[];
  total: number;
  resource_type: string;
  resource_id: string;
  /** Whether this reader may add to it, so the composer is shown or explained. */
  can_comment: boolean;
  /** A windowed listing says whether scrolling up would find more. */
  has_more?: boolean;
  /** Everybody else's "read up to here", for "seen by". */
  reads?: ReadMarker[];
  /** This reader's own marker, as it was before this read — the "new" divider. */
  my_last_read_at?: string | null;
  /** The reactions the server accepts. */
  reactions?: string[];
}

export interface ListOptions {
  /** Newest `limit` top-level lines (a chat window) … */
  limit?: number;
  /** … older than this moment. */
  before?: string;
  /** Or the replies to one line. */
  parent_id?: string;
}

export const commentsApi = {
  list: (resourceType: string, resourceId: string, signal?: AbortSignal, options: ListOptions = {}) =>
    api.get<CommentThread>("/api/comments", {
      params: { resource_type: resourceType, resource_id: resourceId, ...options },
      signal,
    }),
  create: (input: {
    resource_type: string;
    resource_id: string;
    body: string;
    parent_id?: string;
    mention_ids?: string[];
    attachment_ids?: string[];
  }) => api.post<RecordComment>("/api/comments", input),
  update: (id: string, body: string, mentionIds?: string[]) =>
    api.put<RecordComment>(`/api/comments/${id}`, { body, mention_ids: mentionIds }),
  remove: (id: string) => api.delete<{ deleted: boolean; id: string }>(`/api/comments/${id}`),
  react: (id: string, emoji: string) =>
    api.post<RecordComment>(`/api/comments/${id}/reactions`, { emoji }),
  read: (resourceType: string, resourceId: string) =>
    api.post<{ last_read_at: string }>("/api/comments/read", {
      resource_type: resourceType,
      resource_id: resourceId,
    }),
  typing: (resourceType: string, resourceId: string) =>
    api.post<{ sent: boolean }>("/api/comments/typing", {
      resource_type: resourceType,
      resource_id: resourceId,
    }),
};
