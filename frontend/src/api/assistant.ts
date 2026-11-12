/**
 * The AI assistant (§41–46): conversations, a streamed turn, described
 * filters, the daily brief and page help.
 *
 * Everything but the turn is ordinary JSON through `request`. A turn is a
 * stream of server-sent events, read with `fetch` and a reader rather than
 * `EventSource` — `EventSource` cannot POST and cannot carry the bearer
 * token, and both are needed here.
 */

import { API_PREFIX, CORRELATION_HEADER } from "@/config";

import { accessToken, ApiError, getImpersonation, request } from "./client";
import type { QueryNode } from "./explorer";

export type AssistantMode = "general" | "data";

export interface Citation {
  resource_type: string;
  id: string;
  label: string;
  path: string;
  dataset?: string;
}

export interface ToolStep {
  name: string;
  arguments?: Record<string, unknown>;
  summary: string;
}

export interface AssistantMessage {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  mode: AssistantMode;
  status: "complete" | "stopped" | "error";
  citations: Citation[];
  steps: ToolStep[];
  model: string | null;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  latency_ms: number;
  error: string | null;
  created_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  mode: AssistantMode;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
  messages?: AssistantMessage[];
}

export interface ConversationPage {
  items: Conversation[];
  total: number;
}

export interface FilterSuggestion {
  resource_type: string;
  tree: QueryNode;
  explanation: string;
  notes: string[];
  rule_count: number;
  match_count: number | null;
  condition_text: string;
  source: "ai" | "fallback";
}

export interface BriefItem {
  key: string;
  title: string;
  reason: string;
  link: string;
  urgency: "high" | "medium" | "low";
  count: number;
  examples: { label: string; link: string; due?: string | null }[];
  due: string | null;
}

export interface Brief {
  day: string;
  headline: string;
  items: BriefItem[];
  source: "ai" | "fallback";
  model: string | null;
  total_tokens: number;
  generated_at: string;
}

export interface PageHelpRequest {
  path: string;
  question: string;
  stops: { title: string; description: string; target?: string }[];
  controls: { id: string; label: string }[];
  commands: { id: string; label: string; keywords?: string }[];
}

export interface PageHelpAnswer {
  answer: string;
  highlight: string | null;
  action: { id: string; label: string } | null;
  source: "ai" | "fallback";
}

export interface AiUsage {
  calls: number;
  tokens: number;
  by_feature: { feature: string; calls: number; tokens: number }[];
  limit_per_minute: number;
  mode: string;
  model: string;
  real: boolean;
}

/** One event of a streamed turn. */
export type TurnEvent =
  | { type: "start"; conversation_id: string; title: string; mode: AssistantMode; user_message: AssistantMessage }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; status: "running" | "done"; summary?: string }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; message: string; message_saved?: AssistantMessage };

const BASE = "/api/assistant";

export const assistantApi = {
  conversations: (q = "", signal?: AbortSignal) =>
    request<ConversationPage>(`${BASE}/conversations`, { params: { q, page_size: 100 }, signal }),
  create: (body: { mode?: AssistantMode; title?: string } = {}) =>
    request<Conversation>(`${BASE}/conversations`, { method: "POST", body }),
  get: (id: string, signal?: AbortSignal) => request<Conversation>(`${BASE}/conversations/${id}`, { signal }),
  update: (id: string, body: { title?: string; mode?: AssistantMode }) =>
    request<Conversation>(`${BASE}/conversations/${id}`, { method: "PATCH", body }),
  remove: (id: string) => request<{ id: string; deleted: boolean }>(`${BASE}/conversations/${id}`, { method: "DELETE" }),
  usage: (signal?: AbortSignal) => request<AiUsage>(`${BASE}/usage`, { signal }),
  filters: (body: { resource_type: string; question: string; current_tree?: QueryNode | null }) =>
    request<FilterSuggestion>(`${BASE}/filters`, { method: "POST", body }),
  brief: (signal?: AbortSignal) => request<Brief>(`${BASE}/brief`, { signal }),
  refreshBrief: () => request<Brief>(`${BASE}/brief`, { method: "POST" }),
  pageHelp: (body: PageHelpRequest) => request<PageHelpAnswer>(`${BASE}/page-help`, { method: "POST", body }),
  confirmAction: (body: { command_id: string; label: string; path: string }) =>
    request<{ recorded: boolean }>(`${BASE}/page-help/actions`, { method: "POST", body }),
};

/** Split a server-sent-event buffer into complete events and the remainder. */
export function parseEvents(buffer: string): { events: TurnEvent[]; rest: string } {
  const events: TurnEvent[] = [];
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    let name = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).trim());
    }
    if (!data.length) continue;
    try {
      events.push({ type: name, ...(JSON.parse(data.join("\n")) as object) } as TurnEvent);
    } catch {
      // A malformed event is skipped rather than ending the answer.
    }
  }
  return { events, rest };
}

/**
 * Ask, or ask again, and hand each event to `onEvent` as it arrives.
 *
 * Resolves when the stream ends; aborting `signal` is how Stop works — the
 * server saves whatever was written so far.
 */
export async function streamTurn(
  conversationId: string,
  body: { content?: string; regenerate?: boolean; mode?: AssistantMode },
  onEvent: (event: TurnEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const token = await accessToken();
  const impersonating = getImpersonation();
  const response = await fetch(`${API_PREFIX}${BASE}/conversations/${conversationId}/messages`, {
    method: "POST",
    signal,
    headers: {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
      [CORRELATION_HEADER]: crypto.randomUUID().replace(/-/g, ""),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(impersonating ? { "X-Impersonate-User": impersonating } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) {
    const text = await response.text();
    let parsed: { error?: string; message?: string; details?: Record<string, unknown> } = {};
    try {
      parsed = text ? (JSON.parse(text) as typeof parsed) : {};
    } catch {
      parsed = {};
    }
    throw new ApiError(
      response.status,
      { error: parsed.error ?? "error", message: parsed.message ?? `Request failed with ${response.status}`, details: parsed.details },
      response.headers.get(CORRELATION_HEADER) ?? "",
    );
  }
  const reader = response.body.getReader();
  // Stop must end the read even where the transport ignores the abort.
  signal?.addEventListener("abort", () => void reader.cancel().catch(() => undefined), { once: true });
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const { events, rest } = parseEvents(buffer);
    buffer = rest;
    events.forEach(onEvent);
  }
  const { events } = parseEvents(`${buffer}\n\n`);
  events.forEach(onEvent);
}
