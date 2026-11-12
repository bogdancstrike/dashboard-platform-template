import { api } from "./client";

/**
 * Insights (§43): a question about the records, answered as a page composed
 * from a fixed registry of components. The server validates the spec and
 * binds every component's data as the viewer; the client renders it with the
 * same registry (`components/insights/spec.ts`) and skips what it does not know.
 */

export interface InsightSpec {
  version: number;
  title: string;
  summary: string;
  blocks: unknown[];
}

export interface InsightDraft {
  id: string | null;
  question: string;
  title: string;
  summary: string;
  spec: InsightSpec;
  rendered: InsightSpec;
  warnings: string[];
  source: "ai" | "suggested" | "fallback";
  model: string | null;
  usage: Record<string, number> | null;
  refreshed_at: string | null;
}

export interface InsightSummary {
  id: string;
  title: string;
  question: string;
  summary: string;
  datasets: string[];
  source: InsightDraft["source"];
  model: string | null;
  scope: "PRIVATE" | "SHARED" | "PUBLIC";
  pinned: boolean;
  owner: { id: string | null; name: string };
  can_edit: boolean;
  refreshed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  kinds: string[];
}

export interface SavedInsight extends InsightSummary {
  spec: InsightSpec;
  rendered: InsightSpec | null;
  warnings: string[];
  members?: { id: string; name: string; email: string }[];
}

export interface InsightSuggestion {
  key: string;
  dataset: string;
  dataset_label: string;
  question: string;
  title: string;
}

export interface InsightList {
  items: InsightSummary[];
  suggestions: InsightSuggestion[];
  datasets: { key: string; label: string }[];
  can_share: boolean;
}

export const insightsApi = {
  list: (params: { q?: string; scope?: string } = {}, signal?: AbortSignal) =>
    api.get<InsightList>("/api/insights", { params, signal }),
  get: (id: string, fresh = false, signal?: AbortSignal) =>
    api.get<SavedInsight>(`/api/insights/${id}`, { params: fresh ? { fresh: true } : {}, signal }),
  generate: (question: string) => api.post<InsightDraft>("/api/insights/generate", { question }),
  suggestion: (key: string) => api.post<InsightDraft>(`/api/insights/suggestions/${key}`, {}),
  save: (draft: InsightDraft & { scope?: string; pinned?: boolean }) =>
    api.post<SavedInsight>("/api/insights", draft),
  update: (id: string, input: { title?: string; pinned?: boolean; scope?: string; member_ids?: string[] }) =>
    api.put<SavedInsight>(`/api/insights/${id}`, input),
  refresh: (id: string) => api.post<SavedInsight>(`/api/insights/${id}/refresh`, {}),
  remove: (id: string) => api.delete<{ id: string; deleted: boolean }>(`/api/insights/${id}`),
};
