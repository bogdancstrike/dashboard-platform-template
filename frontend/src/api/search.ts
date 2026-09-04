import { api } from "./client";

/**
 * Cross-entity search (§32).
 *
 * Every result carries *why* it matched — which field, and the text around the
 * term — because a ranked list drawn from six tables is unreadable if the
 * reader cannot see what put each row where it is.
 */
export interface GlobalHit {
  id: string;
  resource_type: string;
  label: string;
  summary: string;
  /** Higher is a better match; see services/search.py for the scale. */
  score: number;
  matched_field: string;
  matched_label: string;
  snippet: string;
}

export interface GlobalGroup {
  resource_type: string;
  label: string;
  description: string;
  /** More rows exist in this dataset than were returned. */
  has_more: boolean;
  items: GlobalHit[];
}

export interface GlobalResults {
  query: string;
  total: number;
  groups: GlobalGroup[];
  truncated: boolean;
}

export const searchApi = {
  global: (query: string, signal?: AbortSignal) =>
    api.get<GlobalResults>("/api/search/global", { params: { q: query }, signal }),
};
