/**
 * Ask your documents (§44), mocked with in-memory collections, documents and
 * answers so a test can create a collection, add files, ask and see citations.
 */

import { http, HttpResponse } from "msw";

import type { Answer, Collection, CollectionDetail, KnowledgeDocument } from "@/api/knowledge";

const at = "2026-09-03T11:00:00Z";

function counts(documents: KnowledgeDocument[]) {
  return {
    documents: documents.length,
    ready: documents.filter((d) => d.status === "READY").length,
    pending: documents.filter((d) => ["QUEUED", "PARSING", "EMBEDDING"].includes(d.status)).length,
    failed: documents.filter((d) => d.status === "FAILED").length,
    passages: documents.reduce((sum, d) => sum + d.chunk_count, 0),
    pages: documents.reduce((sum, d) => sum + (d.pages ?? 0), 0),
  };
}

export function knowledgeDocument(partial: Partial<KnowledgeDocument> & { id: string; name: string }): KnowledgeDocument {
  const { name, ...rest } = partial;
  const extension = name.split(".").pop() ?? null;
  return {
    collection_id: "kc-1",
    file: { id: `file-${partial.id}`, name, extension, kind: "DOCUMENT", size_bytes: 4200, mime_type: null },
    status: "READY",
    stalled: false,
    parser: extension === "pdf" ? "docling" : "text",
    error_code: null,
    error_message: null,
    pages: extension === "pdf" ? 3 : null,
    chunk_count: 6,
    embedded_count: 6,
    warnings: [],
    outline: [],
    job_id: null,
    added_at: at,
    ingested_at: at,
    ...rest,
  };
}

function seed() {
  const documents = [
    knowledgeDocument({ id: "kd-1", name: "Employee Handbook.pdf" }),
    knowledgeDocument({ id: "kd-2", name: "Onboarding.md" }),
    knowledgeDocument({
      id: "kd-3",
      name: "Scan.pdf",
      status: "FAILED",
      error_code: "FILE_CONVERTER_UNAVAILABLE",
      chunk_count: 0,
      pages: null,
    }),
  ];
  const collections: CollectionDetail[] = [
    {
      id: "kc-1",
      name: "Company policies",
      description: "The handbook and the security policy.",
      scope: "PUBLIC",
      color: "#2457D6",
      owner: { id: "u-1", name: "Ada Administrator" },
      folder_id: "folder-kn-1",
      counts: counts(documents),
      can_edit: true,
      created_at: at,
      updated_at: at,
      last_asked_at: at,
      members: [],
      documents,
    },
    {
      id: "kc-2",
      name: "Support knowledge base",
      description: "",
      scope: "SHARED",
      color: "#0E9F6E",
      owner: { id: "u-2", name: "Maya Ionescu" },
      folder_id: "folder-kn-2",
      counts: counts([]),
      can_edit: false,
      created_at: at,
      updated_at: at,
      last_asked_at: null,
      members: [],
      documents: [],
    },
  ];
  const answers: Answer[] = [
    {
      id: "kq-1",
      collection_id: "kc-1",
      thread_id: "kt-1",
      question: "How much can I spend on a hotel?",
      answer: "Hotels may cost at most **180 EUR** per night [1]. Claims are due within 30 days [2].",
      citations: [
        {
          n: 1,
          chunk_id: "ch-1",
          document_id: "kd-1",
          file_id: "file-kd-1",
          file_name: "Employee Handbook.pdf",
          extension: "pdf",
          page: 2,
          heading: "Travel",
          quote: "Hotels may cost at most 180 EUR per night in capital cities.",
          boxes: [{ page: 2, x: 0.1, y: 0.3, w: 0.8, h: 0.05 }],
          score: 0.03,
        },
        {
          n: 2,
          chunk_id: "ch-2",
          document_id: "kd-2",
          file_id: "file-kd-2",
          file_name: "Onboarding.md",
          extension: "md",
          page: null,
          heading: "",
          quote: "Expense claims must be filed within 30 days.",
          boxes: [],
          score: 0.02,
        },
      ],
      status: "ANSWERED",
      model: "nucleus-chat",
      usage: null,
      created_at: at,
    },
  ];
  return { collections, answers };
}

export let knowledgeState = seed();

export function resetKnowledge(): void {
  knowledgeState = seed();
}

/** Make the next question fail as the gateway does when the model is down. */
export const knowledgeFlags = { askStatus: 200 };

const summary = ({ documents: _documents, ...rest }: CollectionDetail): Collection => rest;
const find = (id: string) => knowledgeState.collections.find((c) => c.id === id);

export const knowledgeHandlers = [
  http.get("/platform/api/knowledge/overview", () =>
    HttpResponse.json({ collections: 2, documents: 3, pages: 3, passages: 12, pending: 0, questions: 1 }),
  ),
  http.get("/platform/api/knowledge/collections", () =>
    HttpResponse.json({
      items: knowledgeState.collections.map(summary),
      total: knowledgeState.collections.length,
      can_create: true,
      supported_extensions: ["pdf", "docx", "md", "txt"],
    }),
  ),
  http.post("/platform/api/knowledge/collections", async ({ request }) => {
    const body = (await request.json()) as Record<string, string>;
    if (!body["name"]?.trim()) return HttpResponse.json({ message: "A collection needs a name." }, { status: 400 });
    const created: CollectionDetail = {
      ...knowledgeState.collections[1]!,
      id: `kc-${knowledgeState.collections.length + 1}`,
      name: body["name"],
      description: body["description"] ?? "",
      scope: (body["scope"] as CollectionDetail["scope"] | undefined) ?? "PRIVATE",
      can_edit: true,
      documents: [],
    };
    knowledgeState.collections.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.get("/platform/api/knowledge/collections/:id", ({ params }) => {
    const found = find(String(params["id"]));
    return found ? HttpResponse.json(found) : HttpResponse.json({ message: "not found" }, { status: 404 });
  }),
  http.put("/platform/api/knowledge/collections/:id", async ({ request, params }) => {
    const found = find(String(params["id"]))!;
    Object.assign(found, (await request.json()) as Record<string, unknown>);
    return HttpResponse.json(found);
  }),
  http.delete("/platform/api/knowledge/collections/:id", ({ params }) => {
    knowledgeState.collections = knowledgeState.collections.filter((c) => c.id !== String(params["id"]));
    return HttpResponse.json({ id: params["id"], deleted: true });
  }),
  http.post("/platform/api/knowledge/collections/:id/documents", async ({ request, params }) => {
    const found = find(String(params["id"]))!;
    const body = (await request.json()) as { file_ids: string[] };
    const added = body.file_ids.map((_fileId, index) =>
      knowledgeDocument({ id: `kd-new-${index}`, name: `upload-${index}.pdf`, status: "QUEUED", file: undefined }),
    );
    added.forEach((d, index) => (d.file = { ...d.file, id: body.file_ids[index] ?? null, name: "upload.pdf", extension: "pdf", kind: "DOCUMENT", size_bytes: 10, mime_type: null }));
    found.documents = [...added, ...found.documents];
    found.counts = counts(found.documents);
    return HttpResponse.json({ added, skipped: [] }, { status: 201 });
  }),
  http.post("/platform/api/knowledge/collections/:id/documents/:doc/reprocess", ({ params }) => {
    const found = find(String(params["id"]))!;
    const document = found.documents.find((d) => d.id === String(params["doc"]))!;
    document.status = "QUEUED";
    return HttpResponse.json(document, { status: 202 });
  }),
  http.delete("/platform/api/knowledge/collections/:id/documents/:doc", ({ params }) => {
    const found = find(String(params["id"]))!;
    found.documents = found.documents.filter((d) => d.id !== String(params["doc"]));
    found.counts = counts(found.documents);
    return HttpResponse.json({ id: params["doc"], removed: true });
  }),
  http.get("/platform/api/knowledge/collections/:id/history", ({ request, params }) => {
    const thread = new URL(request.url).searchParams.get("thread_id");
    const mine = knowledgeState.answers.filter((a) => a.collection_id === String(params["id"]));
    const threads = [...new Set(mine.map((a) => a.thread_id))].map((id) => ({
      thread_id: id,
      title: mine.find((a) => a.thread_id === id)!.question,
      updated_at: at,
      turns: mine.filter((a) => a.thread_id === id).length,
    }));
    return HttpResponse.json({ items: mine.filter((a) => !thread || a.thread_id === thread), threads });
  }),
  http.delete("/platform/api/knowledge/collections/:id/threads/:thread", ({ params }) => {
    knowledgeState.answers = knowledgeState.answers.filter((a) => a.thread_id !== String(params["thread"]));
    return HttpResponse.json({ thread_id: params["thread"], removed: 1 });
  }),
  http.get("/platform/api/knowledge/collections/:id/suggestions", () =>
    HttpResponse.json({ items: ["What do the documents say about remote work?"] }),
  ),
  http.get("/platform/api/knowledge/collections/:id/passages/:chunk", ({ params }) => {
    const citation = knowledgeState.answers.flatMap((a) => a.citations).find((c) => c.chunk_id === String(params["chunk"]));
    if (!citation) return HttpResponse.json({ message: "not found" }, { status: 404 });
    const { quote, ...rest } = citation;
    return HttpResponse.json({ ...rest, text: quote });
  }),
  http.post("/platform/api/knowledge/ask", async ({ request }) => {
    if (knowledgeFlags.askStatus !== 200) {
      return HttpResponse.json({ message: "The AI model could not answer just now." }, { status: knowledgeFlags.askStatus });
    }
    const body = (await request.json()) as { collection_id: string; question: string; thread_id?: string | null };
    const answer: Answer = {
      ...knowledgeState.answers[0]!,
      id: `kq-${knowledgeState.answers.length + 1}`,
      collection_id: body.collection_id,
      thread_id: body.thread_id ?? "kt-new",
      question: body.question,
    };
    knowledgeState.answers.push(answer);
    return HttpResponse.json(answer);
  }),
];
