import { api } from "./client";

import type { AnalysisDimension, AnalysisMeasure, AnalysisResult } from "./analysis";
import type { QueryNode } from "./explorer";

/**
 * Saved reports (§28).
 *
 * A report is a *saved analysis*: the dataset, the grouping, the measures, the
 * filters, the period and how to draw it. Running one goes through the same
 * compiler the analytics workspace uses, so a report cannot disagree with the
 * screen it was built on.
 *
 * Sharing is the model saved searches use — private, shared with named
 * members, or public; only the owner writes — because one mechanism for every
 * saved thing is the point of `resource_shares`.
 */
export type ReportScope = "PRIVATE" | "SHARED" | "PUBLIC";

export interface ReportMember {
  id: string;
  name: string;
  email: string;
}

export interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  resource_type: string;
  scope: ReportScope;
  owner: { id: string; name: string; email: string | null };
  /** Whether this reader may change it — owner, and holding reports.manage. */
  can_edit: boolean;
  members: ReportMember[];
  dimensions: AnalysisDimension[];
  metrics: AnalysisMeasure[];
  filters: Record<string, string>;
  condition_tree: QueryNode | null;
  period: string;
  visualization: string;
  sort: string | null;
  order: string;
  schedule: string | null;
  is_favorite: boolean;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReportList {
  items: SavedReport[];
  total: number;
  /** The chart kinds a report may name, from the renderer that draws them. */
  visualizations: string[];
  can_create: boolean;
  can_share: boolean;
}

export interface ReportRun {
  report: SavedReport;
  result: AnalysisResult;
}

/** What a form sends — the same shape the API validates against. */
export interface ReportInput {
  name?: string;
  description?: string | null;
  resource_type?: string;
  scope?: ReportScope;
  member_ids?: string[];
  dimensions?: AnalysisDimension[];
  metrics?: AnalysisMeasure[];
  filters?: Record<string, string>;
  condition_tree?: QueryNode | null;
  period?: string;
  visualization?: string;
  is_favorite?: boolean;
}

export const reportsApi = {
  list: (signal?: AbortSignal) => api.get<ReportList>("/api/reports", { signal }),
  get: (id: string, signal?: AbortSignal) =>
    api.get<SavedReport>(`/api/reports/${id}`, { signal }),
  create: (input: ReportInput) => api.post<SavedReport>("/api/reports", input),
  update: (id: string, input: ReportInput) => api.put<SavedReport>(`/api/reports/${id}`, input),
  remove: (id: string) => api.delete<{ deleted: boolean }>(`/api/reports/${id}`),
  duplicate: (id: string) => api.post<SavedReport>(`/api/reports/${id}/duplicate`),
  run: (id: string, overrides: { period?: string } = {}, signal?: AbortSignal) =>
    api.post<ReportRun>(`/api/reports/${id}/run`, overrides, { signal }),
};
