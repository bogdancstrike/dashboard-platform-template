import { api } from "./client";

/**
 * Team chat (§47).
 *
 * The room — who is in it, what is unread, what it is called — is here. The
 * *messages* are comments on the channel (`commentsApi` with `resource_type =
 * "chat_channel"`), so a channel and a ticket's thread share every rule about
 * mentions, replies, reactions, files, edits and read receipts.
 */
export type ChannelKind = "CHANNEL" | "DIRECT";
export type ChannelVisibility = "PUBLIC" | "PRIVATE";
export type PresenceStatus = "online" | "away" | "offline";

export const CHAT_RESOURCE = "chat_channel";

export interface ChannelPerson {
  id: string;
  name: string;
  avatar_url: string | null;
  job_title: string | null;
  role?: "OWNER" | "MEMBER";
  is_me?: boolean;
}

export interface ChannelSummary {
  id: string;
  /** A channel's name, or the other person's for a direct conversation. */
  name: string;
  topic: string | null;
  kind: ChannelKind;
  visibility: ChannelVisibility;
  is_member: boolean;
  member_count: number;
  other: ChannelPerson | null;
  unread: number;
  mentions: number;
  muted: boolean;
  last_message: { body: string; author: string; at: string } | null;
  last_message_at: string | null;
  archived: boolean;
}

export interface ChannelDetail extends ChannelSummary {
  members: ChannelPerson[];
  created_at: string;
  can_manage: boolean;
  can_post: boolean;
}

export interface ChannelList {
  items: ChannelSummary[];
  unread_total: number;
  mention_total: number;
  can_create: boolean;
}

export interface ChatHit {
  id: string;
  channel_id: string;
  channel_name: string;
  channel_kind: ChannelKind;
  parent_id: string | null;
  body: string;
  author: string;
  created_at: string;
}

export const chatApi = {
  channels: (signal?: AbortSignal) => api.get<ChannelList>("/api/chat/channels", { signal }),
  create: (input: {
    name: string;
    topic?: string;
    visibility?: ChannelVisibility;
    member_ids?: string[];
  }) => api.post<ChannelDetail>("/api/chat/channels", input),
  get: (id: string, signal?: AbortSignal) =>
    api.get<ChannelDetail>(`/api/chat/channels/${id}`, { signal }),
  update: (id: string, input: { name?: string; topic?: string; muted?: boolean }) =>
    api.put<ChannelDetail>(`/api/chat/channels/${id}`, input),
  archive: (id: string) => api.delete<{ archived: boolean }>(`/api/chat/channels/${id}`),
  join: (id: string) => api.post<ChannelDetail>(`/api/chat/channels/${id}/join`, {}),
  leave: (id: string) => api.post<{ left: boolean }>(`/api/chat/channels/${id}/leave`, {}),
  addMembers: (id: string, memberIds: string[]) =>
    api.post<ChannelDetail>(`/api/chat/channels/${id}/members`, { member_ids: memberIds }),
  removeMember: (id: string, userId: string) =>
    api.delete<ChannelDetail>(`/api/chat/channels/${id}/members/${userId}`),
  direct: (userId: string) => api.post<ChannelDetail>("/api/chat/direct", { user_id: userId }),
  search: (q: string, signal?: AbortSignal) =>
    api.get<{ items: ChatHit[]; total: number; q: string }>("/api/chat/search", {
      params: { q },
      signal,
    }),
  presence: (signal?: AbortSignal) =>
    api.get<{ statuses: Record<string, PresenceStatus> }>("/api/chat/presence", { signal }),
  setPresence: (status: "online" | "away") =>
    api.post<{ status: string }>("/api/chat/presence", { status }),
};
