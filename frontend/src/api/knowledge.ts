import { api } from "./client";

/**
 * Ask your documents (§44): collections of files, where each file's reading
 * stands, and questions answered with numbered citations.
 */

export type DocumentStatus = "QUEUED" | "PARSING" | "EMBEDDING" | "READY" | "FAILED";
export type CollectionScope = "PRIVATE" | "SHARED" | "PUBLIC";

/** Where on its page a passage sits, 0..1 from the top-left corner. */
export interface PassageBox {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CollectionCounts {
  documents: number;
  ready: number;
  pending: number;
  failed: number;
  passages: number;
  pages: number;
}

export interface Collection {
  id: string;
  name: string;
  description: string;
  scope: CollectionScope;
  color: string;
  owner: { id: string | null; name: string };
  folder_id: string | null;
  counts: CollectionCounts;
  can_edit: boolean;
  created_at: string | null;
  updated_at: string | null;
  last_asked_at: string | null;
  members?: { id: string; name: string; email: string }[];
}

export interface KnowledgeDocument {
  id: string;
  collection_id: string;
  file: {
    id: string | null;
    name: string;
    extension: string | null;
    kind: string | null;
    size_bytes: number;
    mime_type: string | null;
  };
  status: DocumentStatus;
  /** Queued or reading for so long that nothing is working on it any more. */
  stalled: boolean;
  parser: string | null;
  error_code: string | null;
  error_message: string | null;
  pages: number | null;
  chunk_count: number;
  embedded_count: number;
  warnings: string[];
  outline: { title: string; page: number | null }[];
  job_id: string | null;
  added_at: string | null;
  ingested_at: string | null;
}

export interface CollectionDetail extends Collection {
  documents: KnowledgeDocument[];
}

export interface CollectionList {
  items: Collection[];
  total: number;
  can_create: boolean;
  supported_extensions: string[];
}

export interface Citation {
  n: number;
  chunk_id: string;
  document_id: string;
  file_id: string | null;
  file_name: string;
  extension: string | null;
  page: number | null;
  heading: string;
  quote: string;
  boxes: PassageBox[];
  score: number;
}

export interface Answer {
  id: string;
  collection_id: string;
  thread_id: string;
  question: string;
  answer: string;
  citations: Citation[];
  status: "ANSWERED" | "NO_ANSWER" | "FAILED";
  model: string | null;
  usage: Record<string, number> | null;
  created_at: string | null;
}

export interface ThreadSummary {
  thread_id: string;
  title: string;
  updated_at: string | null;
  turns: number;
}

export interface KnowledgeOverview {
  collections: number;
  documents: number;
  pages: number;
  passages: number;
  pending: number;
  questions: number;
}

export interface CollectionInput {
  name?: string;
  description?: string;
  scope?: CollectionScope;
  color?: string;
  member_ids?: string[];
}

const base = "/api/knowledge";

export const knowledgeApi = {
  overview: (signal?: AbortSignal) => api.get<KnowledgeOverview>(`${base}/overview`, { signal }),
  list: (params: { q?: string; scope?: string } = {}, signal?: AbortSignal) =>
    api.get<CollectionList>(`${base}/collections`, { params, signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<CollectionDetail>(`${base}/collections/${id}`, { signal }),
  create: (input: CollectionInput) => api.post<CollectionDetail>(`${base}/collections`, input),
  update: (id: string, input: CollectionInput) =>
    api.put<CollectionDetail>(`${base}/collections/${id}`, input),
  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`${base}/collections/${id}`),

  addDocuments: (id: string, fileIds: string[]) =>
    api.post<{ added: KnowledgeDocument[]; skipped: string[] }>(`${base}/collections/${id}/documents`, {
      file_ids: fileIds,
    }),
  reprocess: (id: string, documentId: string) =>
    api.post<KnowledgeDocument>(`${base}/collections/${id}/documents/${documentId}/reprocess`, {}),
  removeDocument: (id: string, documentId: string) =>
    api.delete<{ id: string; removed: boolean }>(`${base}/collections/${id}/documents/${documentId}`),

  ask: (input: { collection_id: string; question: string; thread_id?: string | null }) =>
    api.post<Answer>(`${base}/ask`, input),
  history: (id: string, threadId?: string | null, signal?: AbortSignal) =>
    api.get<{ items: Answer[]; threads: ThreadSummary[] }>(`${base}/collections/${id}/history`, {
      params: threadId ? { thread_id: threadId } : {},
      signal,
    }),
  forgetThread: (id: string, threadId: string) =>
    api.delete<{ thread_id: string; removed: number }>(`${base}/collections/${id}/threads/${threadId}`),
  passage: (id: string, chunkId: string, signal?: AbortSignal) =>
    api
      .get<Omit<Citation, "quote"> & { text: string }>(`${base}/collections/${id}/passages/${chunkId}`, { signal })
      .then(({ text, ...rest }): Citation => ({ ...rest, quote: text })),
  suggestions: (id: string, signal?: AbortSignal) =>
    api.get<{ items: string[] }>(`${base}/collections/${id}/suggestions`, { signal }),
};

/** Whether a document is still being read (and the page should keep polling). */
export function isReading(document: Pick<KnowledgeDocument, "status" | "stalled">): boolean {
  return ["QUEUED", "PARSING", "EMBEDDING"].includes(document.status) && !document.stalled;
}

/** Plain words for what went wrong with a document, by the converter's code. */
export function failureText(code: string | null, message: string | null): string {
  const known: Record<string, string> = {
    FILE_CONVERTER_UNAVAILABLE: "The document converter is not available right now. Reprocess it later.",
    FILE_UNSUPPORTED: "This kind of file cannot be read for questions.",
    FILE_TOO_LARGE: "The file is larger than the converter accepts (50 MB).",
    FILE_ENCRYPTED: "The file is encrypted. Upload an unprotected copy.",
    FILE_MACROS: "Files with macros are blocked. Save a copy without macros.",
    FILE_PARSE_TIMEOUT: "Reading took too long. Split the document and try again.",
    FILE_MISSING: "The file's bytes are no longer in storage.",
  };
  return (code && known[code]) || message || "The document could not be read.";
}
