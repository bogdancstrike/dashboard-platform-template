/**
 * The assistant's API (§41–46), mocked with a little in-memory state so a test
 * can create, rename, delete and talk to a conversation and see the history
 * change. A turn answers as a real server-sent-event stream.
 */

import { http, HttpResponse } from "msw";

import type { AssistantMessage, Brief, Conversation, FilterSuggestion } from "@/api/assistant";
import { currentUser } from "@/test/handlers";

const at = "2026-09-03T11:00:00Z";

function message(partial: Partial<AssistantMessage> & Pick<AssistantMessage, "role" | "content">): AssistantMessage {
  return {
    id: crypto.randomUUID(),
    conversation_id: "c-1",
    mode: "general",
    status: "complete",
    citations: [],
    steps: [],
    model: "nucleus-chat",
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    latency_ms: 900,
    error: null,
    created_at: at,
    ...partial,
  };
}

function seed(): Conversation[] {
  return [
    {
      id: "c-1",
      title: "Tickets closest to their SLA",
      mode: "data",
      message_count: 2,
      last_message_at: at,
      created_at: at,
      updated_at: at,
      messages: [
        message({ role: "user", content: "Which tickets are close to SLA?", mode: "data" }),
        message({
          role: "assistant",
          mode: "data",
          content: "Two are close:\n\n| Ticket | Due |\n|---|---|\n| [TIC-1](/tickets/t-1) | today |\n\n- first **bold**\n- `code`",
          citations: [{ resource_type: "ticket", id: "t-1", label: "TIC-1", path: "/tickets/t-1", dataset: "Tickets" }],
          steps: [{ name: "search_records", summary: "Found 2 in ticket" }],
        }),
      ],
    },
    {
      id: "c-2",
      title: "Release note",
      mode: "general",
      message_count: 0,
      last_message_at: null,
      created_at: at,
      updated_at: at,
      messages: [],
    },
  ];
}

export const assistantState = { conversations: seed(), reply: "Hello from the **assistant**.", failTurn: false };

export function resetAssistant() {
  assistantState.conversations = seed();
  assistantState.reply = "Hello from the **assistant**.";
  assistantState.failTurn = false;
}

export const brief: Brief = {
  day: "2026-09-03",
  headline: "Two things need you before lunch.",
  items: [
    { key: "sla", title: "2 tickets at SLA", reason: "Past their service level.", link: "/tickets", urgency: "high", count: 2,
      examples: [{ label: "TIC-1 Login broken", link: "/tickets/t-1" }], due: at },
    { key: "mail", title: "3 unread conversations", reason: "Unanswered mail.", link: "/mail?only=unread", urgency: "low", count: 3,
      examples: [], due: null },
  ],
  source: "ai",
  model: "nucleus-chat",
  total_tokens: 420,
  generated_at: at,
};

export const filterSuggestion: FilterSuggestion = {
  resource_type: "ticket",
  tree: {
    id: "root",
    type: "group",
    properties: { conjunction: "AND", not: false },
    children1: {
      r1: { id: "r1", type: "rule", properties: { field: "status", operator: "select_equals", value: ["OPEN"], valueSrc: ["value"], valueType: ["select"] } },
    },
  },
  explanation: "Open tickets.",
  notes: ["Ignored “colour”: tickets have no such field."],
  rule_count: 1,
  match_count: 12,
  condition_text: "Status = 'OPEN'",
  source: "ai",
};

const sse = (events: [string, unknown][]) =>
  new HttpResponse(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });

const find = (id: unknown) => assistantState.conversations.find((c) => c.id === id);

export const assistantHandlers = [
  http.get("/platform/api/assistant/conversations", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q")?.toLowerCase() ?? "";
    const items = assistantState.conversations
      .filter((c) => !q || c.title.toLowerCase().includes(q))
      .map(({ messages: _messages, ...rest }) => rest);
    return HttpResponse.json({ items, total: items.length, page: 1, page_size: 100, pages: 1 });
  }),
  http.post("/platform/api/assistant/conversations", async ({ request }) => {
    const body = (await request.json()) as { mode?: "general" | "data" };
    const created: Conversation = {
      id: `c-${assistantState.conversations.length + 1}-${Math.random().toString(16).slice(2, 6)}`,
      title: "New conversation", mode: body.mode ?? "general", message_count: 0, last_message_at: null,
      created_at: at, updated_at: at, messages: [],
    };
    assistantState.conversations.unshift(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get("/platform/api/assistant/conversations/:id", ({ params }) => {
    const convo = find(params["id"]);
    return convo ? HttpResponse.json(convo) : HttpResponse.json({ error: "not_found", message: "That conversation does not exist." }, { status: 404 });
  }),
  http.patch("/platform/api/assistant/conversations/:id", async ({ params, request }) => {
    const convo = find(params["id"]);
    if (!convo) return HttpResponse.json({ error: "not_found", message: "Gone" }, { status: 404 });
    Object.assign(convo, (await request.json()) as object);
    return HttpResponse.json(convo);
  }),
  http.delete("/platform/api/assistant/conversations/:id", ({ params }) => {
    assistantState.conversations = assistantState.conversations.filter((c) => c.id !== params["id"]);
    return HttpResponse.json({ id: params["id"], deleted: true });
  }),
  http.post("/platform/api/assistant/conversations/:id/messages", async ({ params, request }) => {
    const convo = find(params["id"]);
    if (!convo) return HttpResponse.json({ error: "not_found", message: "Gone" }, { status: 404 });
    const body = (await request.json()) as { content?: string; regenerate?: boolean };
    if (assistantState.failTurn) {
      return HttpResponse.json({ error: "rate_limited", message: "You are asking the assistant faster than it can answer." }, { status: 429 });
    }
    const messages = convo.messages ?? [];
    if (body.regenerate) {
      const last = messages.at(-1);
      if (last?.role === "assistant") messages.pop();
    } else {
      messages.push(message({ role: "user", content: body.content ?? "", conversation_id: convo.id }));
    }
    const answer = message({
      role: "assistant", content: assistantState.reply, conversation_id: convo.id, mode: convo.mode,
      citations: convo.mode === "data" ? [{ resource_type: "task", id: "k-1", label: "TSK-1", path: "/tasks/k-1" }] : [],
    });
    messages.push(answer);
    convo.messages = messages;
    convo.message_count = messages.length;
    if (convo.title === "New conversation") convo.title = (body.content ?? "Chat").slice(0, 40);
    const half = Math.ceil(assistantState.reply.length / 2);
    return sse([
      ["start", { conversation_id: convo.id, title: convo.title, mode: convo.mode, user_message: messages.at(-2) }],
      ...(convo.mode === "data"
        ? ([["tool", { name: "search_records", status: "running" }], ["tool", { name: "search_records", status: "done", summary: "Found 1 in task" }]] as [string, unknown][])
        : []),
      ["delta", { text: assistantState.reply.slice(0, half) }],
      ["delta", { text: assistantState.reply.slice(half) }],
      ["done", { message: answer }],
    ]);
  }),
  http.get("/platform/api/assistant/usage", () =>
    HttpResponse.json({ calls: 4, tokens: 1234, by_feature: [{ feature: "chat", calls: 4, tokens: 1234 }], limit_per_minute: 20, mode: "real", model: "nucleus-chat", real: true }),
  ),
  http.post("/platform/api/assistant/filters", async ({ request }) => {
    const body = (await request.json()) as { question: string; resource_type: string };
    if (body.question.includes("fail")) return HttpResponse.json({ error: "service_unavailable", message: "The assistant took too long — try again." }, { status: 503 });
    return HttpResponse.json({ ...filterSuggestion, resource_type: body.resource_type === "auto" ? "ticket" : body.resource_type });
  }),
  http.get("/platform/api/assistant/brief", () => HttpResponse.json(brief)),
  http.post("/platform/api/assistant/brief", () => HttpResponse.json({ ...brief, headline: "Refreshed: one thing left.", source: "fallback" })),
  http.post("/platform/api/assistant/page-help", async ({ request }) => {
    const body = (await request.json()) as { question: string; controls: { id: string }[] };
    if (body.question.includes("fail")) return HttpResponse.json({ error: "service_unavailable", message: "Busy" }, { status: 503 });
    return HttpResponse.json({
      answer: "Press **Search**.",
      highlight: body.controls[0]?.id ?? null,
      action: { id: "test.cmd", label: "Run the test command" },
      source: "ai",
    });
  }),
  http.post("/platform/api/assistant/page-help/actions", () => HttpResponse.json({ recorded: true })),
];

/** The signed-in fixture, with the assistant allowed. */
export function meWithAi() {
  return http.get("/platform/api/me", () =>
    HttpResponse.json({ ...currentUser, permissions: [...currentUser.permissions, "ai.use"] }),
  );
}
