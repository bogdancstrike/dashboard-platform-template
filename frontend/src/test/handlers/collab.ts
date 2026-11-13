/**
 * Collaboration's API (§47–49), mocked with a little in-memory state: chat
 * channels whose messages are comments, presence, the wiki's spaces, pages,
 * history, links and meeting notes. `resetCollab()` restores the fixture.
 */

import { http, HttpResponse } from "msw";

import type { ChannelDetail, ChannelSummary } from "@/api/chat";
import type { RecordComment } from "@/api/comments";
import type { DocBlock, DocPage, DocSpace, Revision, TreeItem } from "@/api/docs";

const NOW = "2026-09-06T12:00:00Z";
export const ME = "00000000-0000-0000-0000-000000000001";
export const MARA = "user-mara";
export const OTTO = "user-otto";

const people = {
  [ME]: { id: ME, name: "Ada Administrator", avatar_url: null, job_title: "Platform Administrator" },
  [MARA]: { id: MARA, name: "Mara Manager", avatar_url: null, job_title: "Manager" },
  [OTTO]: { id: OTTO, name: "Otto Operator", avatar_url: null, job_title: "Operator" },
};

function channel(partial: Partial<ChannelDetail> & Pick<ChannelDetail, "id" | "name">): ChannelDetail {
  return {
    topic: null,
    kind: "CHANNEL",
    visibility: "PUBLIC",
    is_member: true,
    member_count: 3,
    other: null,
    unread: 0,
    mentions: 0,
    muted: false,
    last_message: { body: "Hello", author: "Mara Manager", at: NOW },
    last_message_at: NOW,
    archived: false,
    members: [
      { ...people[ME], role: "OWNER", is_me: true },
      { ...people[MARA], role: "MEMBER", is_me: false },
      { ...people[OTTO], role: "MEMBER", is_me: false },
    ],
    created_at: NOW,
    can_manage: true,
    can_post: true,
    ...partial,
  };
}

function msg(partial: Partial<RecordComment> & Pick<RecordComment, "id" | "body">, channelId = "ch-general"): RecordComment {
  return {
    resource_type: "chat_channel",
    resource_id: channelId,
    parent_id: null,
    author: people[MARA],
    mentions: [],
    reactions: [],
    attachments: [],
    reply_count: 0,
    last_reply_at: null,
    is_internal: false,
    is_pinned: false,
    edited_at: null,
    created_at: "2026-09-06T09:00:00Z",
    can_edit: false,
    ...partial,
  };
}

let channels: ChannelDetail[] = [];
let messages: RecordComment[] = [];
let reads: Record<string, string> = {};
export const collabCalls: Array<{ method: string; path: string; body?: unknown }> = [];

function seedChat() {
  channels = [
    channel({ id: "ch-general", name: "general", topic: "Company news", unread: 2, mentions: 1 }),
    channel({ id: "ch-eng", name: "engineering", unread: 0 }),
    channel({ id: "ch-lead", name: "leadership", visibility: "PRIVATE", member_count: 2 }),
    channel({ id: "ch-sales", name: "sales", is_member: false, can_manage: false }),
    channel({
      id: "dm-mara",
      name: "Mara Manager",
      kind: "DIRECT",
      visibility: "PRIVATE",
      other: people[MARA],
      member_count: 2,
      unread: 1,
      can_manage: false,
      members: [
        { ...people[ME], is_me: true },
        { ...people[MARA], is_me: false },
      ],
    }),
  ];
  messages = [
    msg({
      id: "m-1",
      body: "Welcome to **#general** — use `threads` for follow-ups.",
      author: people[ME],
      can_edit: true,
      created_at: "2026-09-05T09:00:00Z",
      reactions: [{ emoji: "👍", count: 2, mine: true, people: ["Ada Administrator", "Mara Manager"] }],
      reply_count: 1,
      last_reply_at: "2026-09-05T09:30:00Z",
    }),
    msg({ id: "m-1r", body: "Got it", parent_id: "m-1", created_at: "2026-09-05T09:30:00Z" }),
    msg({
      id: "m-2",
      body: "@Ada Administrator can you confirm the deck?",
      mentions: [ME],
      created_at: "2026-09-06T10:00:00Z",
      attachments: [{ id: "file-1", name: "deck.pdf", size_bytes: 2048, mime_type: "application/pdf" }],
    }),
    msg({ id: "m-3", body: "And the agenda", created_at: "2026-09-06T10:01:00Z" }),
    msg({ id: "d-1", body: "Got a minute?", created_at: "2026-09-06T11:00:00Z" }, "dm-mara"),
  ];
  reads = { "ch-general": "2026-09-06T09:30:00Z" };
}

function summary(item: ChannelDetail): ChannelSummary {
  const { members: _m, created_at: _c, can_manage: _g, can_post: _p, ...rest } = item;
  return rest;
}

// ── wiki ──────────────────────────────────────────────────────────────────

let spaces: DocSpace[] = [];
let pages: DocPage[] = [];
let revisions: Record<string, Revision[]> = {};

function space(partial: Partial<DocSpace> & Pick<DocSpace, "id" | "name">): DocSpace {
  return { key: partial.id, description: "About it", icon: "🛠️", color: "#2457D6", kind: "GENERAL", page_count: 2, ...partial };
}

function page(partial: Partial<DocPage> & Pick<DocPage, "id" | "title">): DocPage {
  return {
    space: spaces[0]!,
    parent_id: null,
    icon: "📄",
    blocks: [],
    version: 1,
    template: null,
    breadcrumbs: [],
    links: [],
    tasks: {},
    event: null,
    created_by: { id: ME, name: "Ada Administrator", avatar_url: null },
    updated_by: { id: MARA, name: "Mara Manager", avatar_url: null },
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-09-05T09:00:00Z",
    can_edit: true,
    can_create_tasks: true,
    ...partial,
  };
}

function seedDocs() {
  spaces = [
    space({ id: "sp-eng", name: "Engineering" }),
    space({ id: "sp-meet", name: "Meetings", kind: "MEETINGS", icon: "🗓️", page_count: 1 }),
  ];
  const blocks: DocBlock[] = [
    { id: "b1", kind: "heading", text: "How we work", level: 2 },
    { id: "b2", kind: "text", text: "Every change is **reviewed**." },
    { id: "b3", kind: "list", items: ["One", "Two"], ordered: false },
    { id: "b4", kind: "checklist", items: [{ text: "Read this", done: false }] },
    { id: "b5", kind: "quote", text: "Ship it" },
    { id: "b6", kind: "code", text: "ls -la", language: "bash" },
    { id: "b7", kind: "callout", text: "Careful", tone: "warning" },
    { id: "b8", kind: "table", rows: [["What", "Who"], ["Code", "Eng"]], header: true },
    { id: "b9", kind: "divider" },
    { id: "b10", kind: "record", resource_type: "task", resource_id: "task-1", label: "Wire the API" },
  ];
  pages = [
    page({
      id: "pg-handbook",
      title: "Engineering handbook",
      icon: "🛠️",
      blocks,
      links: [{ id: "ln-1", resource_type: "task", resource_id: "task-1", label: "Wire the API", source: "MENTION" }],
    }),
    page({ id: "pg-runbook", title: "On-call runbook", parent_id: "pg-handbook", icon: "🚨", breadcrumbs: [{ id: "pg-handbook", title: "Engineering handbook", icon: "🛠️" }] }),
    page({
      id: "pg-notes",
      title: "Vendor call — 2026-09-05",
      space: spaces[1]!,
      icon: "🗓️",
      template: "meeting",
      event: {
        id: "event-1",
        title: "Vendor call",
        starts_at: "2026-09-05T10:00:00Z",
        ends_at: "2026-09-05T11:00:00Z",
        location: "Room 4",
        participants: [{ user_id: MARA, name: "Mara Manager", response: "ACCEPTED" }],
      },
      blocks: [
        { id: "a1", kind: "action", text: "Send the summary", assignee_id: MARA, due_date: "2026-09-10", task_id: null, done: false },
        { id: "a2", kind: "action", text: "Book follow-up", assignee_id: null, due_date: null, task_id: "task-9", done: false },
      ],
      tasks: { "task-9": { id: "task-9", reference: "TSK-9", title: "Book follow-up", status: "IN_PROGRESS", due_date: null, assignee: "Otto Operator" } },
      links: [{ id: "ln-2", resource_type: "task", resource_id: "task-9", label: "Book follow-up", source: "ACTION" }],
    }),
  ];
  revisions = {
    "pg-handbook": [
      { id: "rv-2", version: 1, title: "Engineering handbook", note: null, author: { id: MARA, name: "Mara Manager", avatar_url: null }, created_at: "2026-09-05T09:00:00Z", blocks: 10, is_current: true },
      { id: "rv-1", version: 0, title: "Old handbook", note: "Created", author: { id: ME, name: "Ada Administrator", avatar_url: null }, created_at: "2026-09-01T09:00:00Z", blocks: 1, is_current: false },
    ],
  };
}

export function resetCollab() {
  seedChat();
  seedDocs();
  collabCalls.length = 0;
}
resetCollab();

function record(request: Request, body?: unknown) {
  collabCalls.push({ method: request.method, path: new URL(request.url).pathname.replace("/platform", ""), body });
}

function findPage(id: string) {
  return pages.find((item) => item.id === id);
}

export const collabHandlers = [
  // ── chat ────────────────────────────────────────────────────────────────
  http.get("/platform/api/chat/channels", () =>
    HttpResponse.json({
      items: channels.filter((item) => !item.archived).map(summary),
      unread_total: channels.reduce((sum, item) => sum + item.unread, 0),
      mention_total: 1,
      can_create: true,
    }),
  ),
  http.post("/platform/api/chat/channels", async ({ request }) => {
    const body = (await request.json()) as { name: string; topic?: string; visibility?: string };
    record(request, body);
    const created = channel({ id: `ch-${channels.length + 1}`, name: body.name, topic: body.topic ?? null, visibility: (body.visibility as "PUBLIC") ?? "PUBLIC", unread: 0 });
    channels.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post("/platform/api/chat/direct", async ({ request }) => {
    record(request, await request.json());
    return HttpResponse.json(channels.find((item) => item.id === "dm-mara"));
  }),
  http.get("/platform/api/chat/search", ({ request }) => {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const items = messages
      .filter((item) => item.body.toLowerCase().includes(q.toLowerCase()))
      .map((item) => ({
        id: item.id,
        channel_id: item.resource_id,
        channel_name: channels.find((c) => c.id === item.resource_id)?.name ?? "",
        channel_kind: channels.find((c) => c.id === item.resource_id)?.kind ?? "CHANNEL",
        parent_id: item.parent_id,
        body: item.body,
        author: item.author.name,
        created_at: item.created_at,
      }));
    return HttpResponse.json({ items, total: items.length, q });
  }),
  http.get("/platform/api/chat/presence", () =>
    HttpResponse.json({ statuses: { [ME]: "online", [MARA]: "online", [OTTO]: "away" } }),
  ),
  http.post("/platform/api/chat/presence", async ({ request }) => {
    const body = (await request.json()) as { status: string };
    record(request, body);
    return HttpResponse.json({ user_id: ME, status: body.status });
  }),
  http.get("/platform/api/chat/channels/:id", ({ params }) => {
    const found = channels.find((item) => item.id === params["id"]);
    return found ? HttpResponse.json(found) : HttpResponse.json({ error: "not_found", message: "That conversation does not exist." }, { status: 404 });
  }),
  http.put("/platform/api/chat/channels/:id", async ({ request, params }) => {
    const body = (await request.json()) as Partial<ChannelDetail>;
    record(request, body);
    const found = channels.find((item) => item.id === params["id"])!;
    Object.assign(found, body);
    return HttpResponse.json(found);
  }),
  http.delete("/platform/api/chat/channels/:id", ({ request, params }) => {
    record(request);
    const found = channels.find((item) => item.id === params["id"])!;
    found.archived = true;
    return HttpResponse.json({ archived: true, id: found.id });
  }),
  http.post("/platform/api/chat/channels/:id/join", ({ request, params }) => {
    record(request);
    const found = channels.find((item) => item.id === params["id"])!;
    found.is_member = true;
    return HttpResponse.json(found);
  }),
  http.post("/platform/api/chat/channels/:id/leave", ({ request, params }) => {
    record(request);
    const found = channels.find((item) => item.id === params["id"])!;
    found.is_member = false;
    return HttpResponse.json({ left: true, id: found.id });
  }),
  http.post("/platform/api/chat/channels/:id/members", async ({ request, params }) => {
    record(request, await request.json());
    return HttpResponse.json(channels.find((item) => item.id === params["id"]));
  }),
  http.delete("/platform/api/chat/channels/:id/members/:user", ({ request, params }) => {
    record(request);
    const found = channels.find((item) => item.id === params["id"])!;
    found.members = found.members.filter((member) => member.id !== params["user"]);
    return HttpResponse.json(found);
  }),

  // ── conversations (chat channels; records fall through) ────────────────
  http.post("/platform/api/comments/read", async ({ request }) => {
    const body = (await request.json()) as { resource_id: string };
    record(request, body);
    return HttpResponse.json({ last_read_at: NOW, resource_id: body.resource_id });
  }),
  http.post("/platform/api/comments/typing", async ({ request }) => {
    record(request, await request.json());
    return HttpResponse.json({ sent: true });
  }),
  http.post("/platform/api/comments/:id/reactions", async ({ request, params }) => {
    const body = (await request.json()) as { emoji: string };
    record(request, body);
    const found = messages.find((item) => item.id === params["id"]);
    if (!found) return HttpResponse.json({ id: params["id"], reactions: [{ emoji: body.emoji, count: 1, mine: true, people: ["Ada Administrator"] }] });
    const existing = found.reactions?.find((item) => item.emoji === body.emoji);
    if (existing?.mine) {
      existing.count -= 1;
      existing.mine = false;
      found.reactions = found.reactions!.filter((item) => item.count > 0);
    } else if (existing) {
      existing.count += 1;
      existing.mine = true;
    } else {
      found.reactions = [...(found.reactions ?? []), { emoji: body.emoji, count: 1, mine: true, people: ["Ada Administrator"] }];
    }
    return HttpResponse.json(found);
  }),
  http.get("/platform/api/comments", ({ request }) => {
    const query = new URL(request.url).searchParams;
    if (query.get("resource_type") !== "chat_channel") return undefined;
    const id = query.get("resource_id") ?? "";
    const parent = query.get("parent_id");
    const all = messages.filter((item) => item.resource_id === id);
    const items = parent ? all.filter((item) => item.parent_id === parent) : all.filter((item) => !item.parent_id);
    return HttpResponse.json({
      items,
      total: items.length,
      has_more: query.get("limit") === "50" && id === "ch-general",
      resource_type: "chat_channel",
      resource_id: id,
      can_comment: true,
      reads: [{ user_id: MARA, name: "Mara Manager", avatar_url: null, last_read_at: "2026-09-06T12:00:00Z" }],
      my_last_read_at: reads[id] ?? null,
      reactions: ["👍", "❤️", "🎉", "😄"],
    });
  }),
  http.post("/platform/api/comments", async ({ request }) => {
    const body = (await request.clone().json()) as { resource_type: string; resource_id: string; body: string; parent_id?: string; mention_ids?: string[]; attachment_ids?: string[] };
    if (body.resource_type !== "chat_channel") return undefined;
    record(request, body);
    const created = msg(
      { id: `m-${messages.length + 10}`, body: body.body, parent_id: body.parent_id ?? null, author: people[ME], can_edit: true, created_at: NOW, mentions: body.mention_ids ?? [] },
      body.resource_id,
    );
    messages.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  // ── wiki ────────────────────────────────────────────────────────────────
  http.get("/platform/api/docs/spaces", () => HttpResponse.json({ items: spaces, can_edit: true })),
  http.post("/platform/api/docs/spaces", async ({ request }) => {
    const body = (await request.json()) as { name: string };
    record(request, body);
    const created = space({ id: `sp-${spaces.length + 1}`, name: body.name, page_count: 0 });
    spaces.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get("/platform/api/docs/spaces/:id", ({ params }) => {
    const found = spaces.find((item) => item.id === params["id"]);
    if (!found) return HttpResponse.json({ error: "not_found", message: "That space does not exist." }, { status: 404 });
    const items: TreeItem[] = pages
      .filter((item) => item.space.id === found.id)
      .map((item, index) => ({ id: item.id, parent_id: item.parent_id, title: item.title, icon: item.icon, position: index * 1024, updated_at: item.updated_at, is_meeting: Boolean(item.event) }));
    return HttpResponse.json({ space: found, items });
  }),
  http.get("/platform/api/docs/pages", () =>
    HttpResponse.json({
      items: pages.map((item) => ({ id: item.id, title: item.title, icon: item.icon, space: item.space.name, space_id: item.space.id, updated_at: item.updated_at, updated_by: item.updated_by, is_meeting: Boolean(item.event) })),
    }),
  ),
  http.post("/platform/api/docs/pages", async ({ request }) => {
    const body = (await request.json()) as { space_id: string; title?: string; template?: string; parent_id?: string | null };
    record(request, body);
    const created = page({
      id: `pg-${pages.length + 1}`,
      title: body.title || (body.template === "meeting" ? "Meeting notes" : "Untitled"),
      parent_id: body.parent_id ?? null,
      space: spaces.find((item) => item.id === body.space_id) ?? spaces[0]!,
      template: body.template ?? null,
      blocks: [{ id: "n1", kind: "text", text: "" }],
      updated_by: { id: ME, name: "Ada Administrator", avatar_url: null },
    });
    pages.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get("/platform/api/docs/search", ({ request }) => {
    const q = (new URL(request.url).searchParams.get("q") ?? "").toLowerCase();
    const items = pages
      .filter((item) => item.title.toLowerCase().includes(q))
      .map((item) => ({ id: item.id, title: item.title, icon: item.icon, space: item.space.name, space_id: item.space.id, updated_at: item.updated_at, snippet: `… ${item.title} …` }));
    return HttpResponse.json({ items, total: items.length, q });
  }),
  http.get("/platform/api/docs/templates", () =>
    HttpResponse.json({
      items: [
        { key: "blank", name: "Blank page", icon: "📄", description: "Start from nothing.", blocks: [] },
        { key: "meeting", name: "Meeting notes", icon: "🗓️", description: "Agenda and action items.", blocks: [] },
        { key: "runbook", name: "Runbook", icon: "🛠️", description: "Symptoms and the fix.", blocks: [] },
      ],
    }),
  ),
  http.get("/platform/api/docs/backlinks", ({ request }) => {
    const id = new URL(request.url).searchParams.get("resource_id");
    const items = pages
      .filter((item) => item.links.some((link) => link.resource_id === id))
      .map((item) => ({ id: item.id, title: item.title, icon: item.icon, space: item.space.name, space_id: item.space.id, updated_at: item.updated_at, source: "MENTION", is_meeting: Boolean(item.event) }));
    return HttpResponse.json({ items, can_edit: true });
  }),
  http.get("/platform/api/docs/meetings", ({ request }) => {
    const id = new URL(request.url).searchParams.get("event_id");
    const items = pages
      .filter((item) => item.event?.id === id)
      .map((item) => ({ id: item.id, title: item.title, updated_at: item.updated_at, created_by: item.created_by, actions: 2, tasks: 1 }));
    return HttpResponse.json({ items, can_edit: true });
  }),
  http.post("/platform/api/docs/meetings", async ({ request }) => {
    const body = (await request.json()) as { event_id: string };
    record(request, body);
    const existing = pages.find((item) => item.event?.id === body.event_id);
    if (existing) return HttpResponse.json({ ...existing, created: false });
    const created = page({ id: `pg-${pages.length + 1}`, title: "Standup — 2026-09-06", space: spaces[1]!, event: { id: body.event_id, title: "Standup", starts_at: NOW, ends_at: NOW, location: null, participants: [] } });
    pages.push(created);
    return HttpResponse.json({ ...created, created: true });
  }),
  http.get("/platform/api/docs/pages/:id", ({ params }) => {
    const found = findPage(String(params["id"]));
    return found ? HttpResponse.json(found) : HttpResponse.json({ error: "not_found", message: "That page does not exist." }, { status: 404 });
  }),
  http.put("/platform/api/docs/pages/:id", async ({ request, params }) => {
    const body = (await request.json()) as Partial<DocPage> & { expected_version?: number };
    record(request, body);
    const found = findPage(String(params["id"]))!;
    if (body.expected_version !== undefined && body.expected_version !== found.version) {
      return HttpResponse.json({ error: "conflict", message: "Somebody else saved this page." }, { status: 409 });
    }
    const { expected_version: _e, ...rest } = body;
    Object.assign(found, rest, { version: found.version + 1 });
    return HttpResponse.json(found);
  }),
  http.delete("/platform/api/docs/pages/:id", ({ request, params }) => {
    record(request);
    pages = pages.filter((item) => item.id !== params["id"]);
    return HttpResponse.json({ deleted: 1, id: params["id"] });
  }),
  http.post("/platform/api/docs/pages/:id/move", async ({ request, params }) => {
    const body = (await request.json()) as { parent_id?: string | null };
    record(request, body);
    const found = findPage(String(params["id"]))!;
    found.parent_id = body.parent_id ?? null;
    return HttpResponse.json({ id: found.id, parent_id: found.parent_id });
  }),
  http.get("/platform/api/docs/pages/:id/revisions", ({ params }) =>
    HttpResponse.json({ items: revisions[String(params["id"])] ?? [], current_version: 1 }),
  ),
  http.get("/platform/api/docs/pages/:id/revisions/:rev", ({ params }) =>
    HttpResponse.json({ id: params["rev"], version: 0, title: "Old handbook", blocks: [{ id: "o1", kind: "text", text: "The first draft" }] }),
  ),
  http.post("/platform/api/docs/pages/:id/revisions/:rev/restore", ({ request, params }) => {
    record(request);
    const found = findPage(String(params["id"]))!;
    Object.assign(found, { title: "Old handbook", blocks: [{ id: "o1", kind: "text", text: "The first draft" }], version: found.version + 1 });
    return HttpResponse.json(found);
  }),
  http.post("/platform/api/docs/pages/:id/links", async ({ request, params }) => {
    const body = (await request.json()) as { resource_type: string; resource_id: string };
    record(request, body);
    const found = findPage(String(params["id"]))!;
    found.links = [...found.links, { id: `ln-${found.links.length + 10}`, resource_type: body.resource_type, resource_id: body.resource_id, label: "Picked record", source: "MANUAL" }];
    return HttpResponse.json({ links: found.links });
  }),
  http.delete("/platform/api/docs/pages/:id/links/:link", ({ request, params }) => {
    record(request);
    const found = findPage(String(params["id"]))!;
    found.links = found.links.filter((item) => item.id !== params["link"]);
    return HttpResponse.json({ links: found.links });
  }),
  http.post("/platform/api/docs/pages/:id/actions", async ({ request, params }) => {
    const body = (await request.json()) as { block_id: string };
    record(request, body);
    const found = findPage(String(params["id"]))!;
    found.blocks = found.blocks.map((block) => (block.id === body.block_id ? { ...block, task_id: "task-new" } : block));
    found.tasks = { ...found.tasks, "task-new": { id: "task-new", reference: "TSK-100", title: "Send the summary", status: "NEW", due_date: "2026-09-10", assignee: "Mara Manager" } };
    return HttpResponse.json(found);
  }),
  http.post("/platform/api/docs/pages/:id/summary", ({ request }) => {
    record(request);
    return HttpResponse.json({ summary: "The team agreed to **ship on Friday**.", page_id: "pg-handbook" });
  }),
];
