import { api } from "./client";

/**
 * The mailbox (§14–§16).
 *
 * Two things to keep in mind reading these types.
 *
 * A **thread** carries its own summary — `message_count`, `unread_count`,
 * `snippet`, `participants` — because an inbox list that joined messages to
 * render a row is an inbox nobody waits for. Those fields are the server's
 * recomputation, never something to adjust here: a badge the browser
 * decrements is a badge that drifts.
 *
 * A sent message lands in **OUTBOX**, not `SENT`. There is no mail transport
 * in this template, and the folder is the whole claim the row makes.
 *
 * See `services/mail.py`.
 */

export type MailFolder =
  | "INBOX"
  | "OUTBOX"
  | "SENT"
  | "DRAFTS"
  | "ARCHIVE"
  | "SPAM"
  | "TRASH";

export interface MailAddress {
  name: string;
  email: string;
}

export interface MailMessage {
  id: string;
  thread_id: string | null;
  reference: string;
  subject: string;
  from: { name: string | null; email: string | null; initials: string };
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  body: string;
  preview: string | null;
  folder: MailFolder;
  is_read: boolean;
  is_starred: boolean;
  is_draft: boolean;
  priority: "LOW" | "NORMAL" | "HIGH";
  sent_at: string | null;
  read_at: string | null;
  attachment_count: number;
  attachments: Array<{
    id: string;
    name: string;
    mime_type: string | null;
    size_bytes: number;
    file_id: string | null;
  }>;
}

export interface MailThread {
  id: string;
  subject: string;
  folder: MailFolder;
  message_count: number;
  /** The server's recomputation. Never adjusted here. */
  unread_count: number;
  has_attachments: boolean;
  is_starred: boolean;
  is_important: boolean;
  labels: string[];
  last_message_at: string | null;
  participants: Array<MailAddress & { initials: string }>;
  snippet: string | null;
  created_at: string | null;
  /** There is an unfinished message in it — what the list badge means. */
  has_draft: boolean;
  /** Only on a thread that was opened. */
  messages?: MailMessage[];
}

export interface MailList {
  items: MailThread[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sort: string;
  order: string;
  folder: MailFolder;
  /** Every folder, always — an empty Drafts is information. */
  folders: Array<{ key: MailFolder; total: number; unread: number }>;
  /** The labels in use *in this folder*, so a count matches what a click finds. */
  labels: Array<{ key: string; count: number }>;
  priorities: Array<"LOW" | "NORMAL" | "HIGH">;
  /** The folders a person may file a thread into. Never `SENT` or `OUTBOX`. */
  movable: MailFolder[];
}

export interface MailTemplate {
  code: string;
  name: string;
  description: string | null;
  category: string;
  subject: string;
  body: string;
  variables: string[];
}

export interface RenderedTemplate {
  code: string;
  subject: string;
  body: string;
  /** Placeholders nobody supplied — so the composer can say so before a send. */
  unfilled: string[];
}

export type BulkAction = "READ" | "UNREAD" | "STAR" | "UNSTAR" | "MOVE" | "LABEL" | "UNLABEL";

export interface ComposeInput {
  /** Present on a reply: it joins that conversation rather than starting one. */
  thread_id?: string;
  subject?: string;
  body?: string;
  to?: Array<string | MailAddress>;
  cc?: Array<string | MailAddress>;
  bcc?: Array<string | MailAddress>;
  priority?: string;
  template?: string;
  variables?: Record<string, string>;
  /** False, or absent, keeps it a draft. */
  send?: boolean;
}

export const mailApi = {
  threads: (
    params: {
      folder?: string;
      q?: string;
      label?: string;
      starred?: string;
      unread?: string;
      page?: number;
    },
    signal?: AbortSignal,
  ) => api.get<MailList>("/api/mail/threads", { params, signal }),
  /** Reading marks it read. `peek` reads without marking. */
  thread: (id: string, params: { peek?: string } = {}, signal?: AbortSignal) =>
    api.get<MailThread>(`/api/mail/threads/${id}`, { params, signal }),
  updateThread: (
    id: string,
    body: Partial<{
      is_starred: boolean;
      is_important: boolean;
      is_read: boolean;
      labels: string[];
      folder: string;
    }>,
  ) => api.put<MailThread>(`/api/mail/threads/${id}`, body),
  /** Bins it; a second call on a binned thread deletes it for good. */
  removeThread: (id: string) =>
    api.delete<{ deleted: boolean; folder: MailFolder; id: string }>(
      `/api/mail/threads/${id}`,
    ),
  /**
   * One action over many threads. Its own endpoint rather than a loop here:
   * fifty round trips for one gesture, each able to fail on its own, leaves
   * the list in a state nobody chose.
   */
  bulk: (body: { ids: string[]; action: BulkAction; folder?: string; label?: string }) =>
    api.post<{ changed: number; action: BulkAction }>("/api/mail/threads/bulk", body),
  compose: (body: ComposeInput) => api.post<MailThread>("/api/mail/messages", body),
  updateMessage: (id: string, body: ComposeInput) =>
    api.put<MailThread>(`/api/mail/messages/${id}`, body),
  discard: (id: string) =>
    api.delete<{ deleted: boolean; id: string }>(`/api/mail/messages/${id}`),
  templates: (signal?: AbortSignal) =>
    api.get<{ items: MailTemplate[]; total: number }>("/api/mail/templates", { signal }),
  /** Filled on the server, because the substitution rule belongs to the template. */
  render: (code: string, variables: Record<string, string>) =>
    api.post<RenderedTemplate>("/api/mail/templates", { code, variables }),
};
