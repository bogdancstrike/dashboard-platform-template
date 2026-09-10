import { api, download } from "./client";

/**
 * Report documents — a composed page, exported as PDF or DOCX (§28).
 *
 * **This is what makes the report builder a different thing from the chart
 * builder.** A `SavedReport` is a saved *question*: a dataset, a grouping, a
 * measure and a picture. A `ReportDocument` is a *page*: a cover, headings,
 * paragraphs somebody wrote, and the answers to several questions arranged
 * between them, on paper of a stated size with a running header and a page
 * number. The two were one screen for a while, which is why they looked alike.
 *
 * Two rules the client has to respect.
 *
 * **A block names a question; it does not copy one.** A `REPORT` block carries
 * a report id, and rendering runs the stored definition. Nothing here caches
 * an answer, so the same document exported in March and in June is one layout
 * over two months of data.
 *
 * **Charts are captured by the browser.** There is no chart engine on the
 * server, so the render request carries a PNG per chart block — the one
 * ECharts already drew on screen. What lands in the file is what was
 * previewed. A block whose image is missing renders as its own numbers in a
 * table instead.
 */

export type DocumentScope = "PRIVATE" | "SHARED" | "PUBLIC";

/** Every block the renderer can draw. The server refuses anything else. */
export type BlockKind =
  | "HEADING"
  | "TEXT"
  | "REPORT"
  | "TABLE"
  | "METRICS"
  | "DIVIDER"
  | "SPACER"
  | "PAGE_BREAK";

export interface DocumentBlock {
  id: string;
  kind: BlockKind;
  /** `HEADING`, `TEXT`. */
  text?: string;
  /** `HEADING`: 1, 2 or 3. */
  level?: number;
  /** `SPACER`. */
  size?: string;
  /** A line above the block, for anything that draws data. */
  caption?: string;
  /** `REPORT`: the saved report it draws. */
  report_id?: string;
  /** `REPORT`: the picture, its numbers, or both. */
  show?: "chart" | "table" | "both";
  /** `TABLE`, `METRICS`: the dataset. */
  entity?: string;
  /** `TABLE`: which columns, in order. */
  columns?: string[];
  /** `TABLE`, `METRICS`. */
  filters?: Record<string, unknown>;
  sort?: string;
  order?: "asc" | "desc";
  limit?: number;
  /** `METRICS`: which of the dataset's declared numbers. */
  metrics?: string[];
}

/** The paper, and the furniture printed on every page of it. */
export interface DocumentPage {
  size: "A4" | "LETTER";
  orientation: "portrait" | "landscape";
  margin_mm: number;
  header: string;
  footer: string;
  subtitle: string;
  page_numbers: boolean;
  cover: boolean;
  accent: string;
}

export interface ReportDocument {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  scope: DocumentScope;
  page: DocumentPage;
  owner: { id: string; name: string; email: string | null };
  can_edit: boolean;
  members: { id: string; name: string; email: string }[];
  block_count: number;
  /** *What* it holds — a card in a gallery says more than "6 blocks". */
  block_kinds: BlockKind[];
  render_count: number;
  last_rendered_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** Present on a single document, absent from the listing. */
  blocks?: DocumentBlock[];
}

export interface DocumentList {
  items: ReportDocument[];
  total: number;
  block_kinds: BlockKind[];
  formats: string[];
  page_sizes: string[];
  defaults: DocumentPage;
  datasets: { key: string; label: string; path: string }[];
  can_create: boolean;
  can_share: boolean;
}

export interface DocumentInput {
  name?: string;
  description?: string | null;
  scope?: DocumentScope;
  member_ids?: string[];
  page?: Partial<DocumentPage>;
  blocks?: DocumentBlock[];
}

export const reportDocumentsApi = {
  list: (signal?: AbortSignal) => api.get<DocumentList>("/api/report-documents", { signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<ReportDocument>(`/api/report-documents/${id}`, { signal }),
  create: (input: DocumentInput) => api.post<ReportDocument>("/api/report-documents", input),
  update: (id: string, input: DocumentInput) =>
    api.put<ReportDocument>(`/api/report-documents/${id}`, input),
  remove: (id: string) =>
    api.delete<{ id: string; deleted: boolean; name: string }>(`/api/report-documents/${id}`),
  duplicate: (id: string) =>
    api.post<ReportDocument>(`/api/report-documents/${id}/duplicate`, {}),

  /**
   * The file itself.
   *
   * `images` maps a block id to a `data:image/png;base64,…` the page captured
   * from its own chart. Sent rather than re-drawn on the server, so the
   * picture in the document is the picture that was on screen.
   */
  render: (id: string, body: { format: "pdf" | "docx"; images?: Record<string, string> }) =>
    download(`/api/report-documents/${id}/render`, {
      method: "POST",
      body,
      fallbackName: `document.${body.format}`,
    }),
};
