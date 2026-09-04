import { api, download } from "./client";

export type FieldKind = "text" | "enum" | "bool" | "number" | "datetime" | "uuid" | "json" | "array";
export type ExplorerView = "table" | "list" | "cards" | "compact";

export interface ExplorerField {
  name: string;
  label: string;
  kind: FieldKind;
  sortable: boolean;
  filterable: boolean;
  searchable: boolean;
  facet: boolean;
  operators: string[];
  choices: string[];
}

/**
 * One node of a query-builder condition tree, as it travels on the wire.
 *
 * The same JSON that `core/rules.py` compiles into SQL and describes for the
 * query inspector, and that a saved search stores verbatim. Declared here
 * rather than beside the editor because it is part of the API contract, not of
 * one component's internals.
 */
export interface QueryNode {
  id?: string;
  type?: string;
  properties?: Record<string, unknown>;
  /** Keyed by node id, or an array, depending on which export produced it. */
  children1?: Record<string, QueryNode> | QueryNode[];
}

export interface ExplorerResource {
  key: string;
  label: string;
  description: string;
  permission: string;
  record_count: number;
  default_columns: string[];
  default_sort: string;
  fields: ExplorerField[];
}

export interface ExplorerCatalogue {
  items: ExplorerResource[];
  view_modes: ExplorerView[];
}

export interface ExplorerRequest {
  resource_type: string;
  query_text?: string;
  condition_tree?: QueryNode | null;
  filters?: Record<string, unknown>;
  columns?: string[];
  page?: number;
  page_size?: number;
  sort?: string;
  order?: "asc" | "desc";
  /** Compute facet counts. One GROUP BY per faceted column, so it is asked for. */
  facets?: boolean;
}

export interface ExplorerResult {
  items: Array<Record<string, unknown> & { id: string }>;
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sort: string;
  order: "asc" | "desc";
  resource_type: string;
  columns: string[];
  fields: ExplorerField[];
  facets: Record<string, Array<{ value: string; count: number }>>;
  condition_text: string;
  rule_count: number;
  /** The term that was executed, for highlighting what actually matched. */
  query_text: string;
  /** The fields the free-text search covered, and so the ones worth marking. */
  searchable: string[];
}

export interface SavedSearch {
  id: string;
  name: string;
  description: string | null;
  resource_type: string;
  scope: "PRIVATE" | "SHARED" | "PUBLIC";
  owner: { id: string; name: string; email: string | null };
  can_edit: boolean;
  members: Array<{ id: string; name: string; email: string }>;
  condition_tree: QueryNode | null;
  condition_text: string | null;
  filters: Record<string, unknown>;
  query_text: string;
  sort: string;
  order: "asc" | "desc";
  columns: string[];
  page_size: number;
  view_mode: ExplorerView;
  is_favorite: boolean;
  is_default: boolean;
  rule_count: number;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export type SaveSearchInput = Pick<
  SavedSearch,
  | "name"
  | "resource_type"
  | "condition_tree"
  | "filters"
  | "query_text"
  | "sort"
  | "order"
  | "columns"
  | "page_size"
  | "view_mode"
> &
  Partial<Pick<SavedSearch, "description" | "scope" | "is_favorite" | "is_default">> & {
    member_ids?: string[];
  };

export const explorerApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<ExplorerCatalogue>("/api/explorer/catalog", { signal }),
  query: (body: ExplorerRequest, signal?: AbortSignal) =>
    api.post<ExplorerResult>("/api/explorer/query", body, { signal }),
  /**
   * Download the current exploration (§30).
   *
   * A POST, because the question can be a nested condition tree and that does
   * not belong in a query string.
   */
  export: (body: ExplorerRequest & { format: string }) =>
    download("/api/explorer/export", {
      method: "POST",
      body,
      fallbackName: `${body.resource_type}.${body.format}`,
    }),
  saved: (resourceType?: string, signal?: AbortSignal) =>
    api.get<{ items: SavedSearch[]; total: number }>("/api/saved-searches", {
      params: { resource_type: resourceType },
      signal,
    }),
  openSaved: (id: string, signal?: AbortSignal) =>
    api.get<SavedSearch>(`/api/saved-searches/${id}`, { signal }),
  createSaved: (body: SaveSearchInput) =>
    api.post<SavedSearch>("/api/saved-searches", body),
  updateSaved: (id: string, body: Partial<SaveSearchInput>) =>
    api.put<SavedSearch>(`/api/saved-searches/${id}`, body),
  deleteSaved: (id: string) => api.delete<void>(`/api/saved-searches/${id}`),
  duplicateSaved: (id: string) =>
    api.post<SavedSearch>(`/api/saved-searches/${id}/duplicate`),
  /** Hand a saved search to somebody else. Owner-only, audited, irreversible. */
  transferSaved: (id: string, ownerId: string) =>
    api.post<SavedSearch>(`/api/saved-searches/${id}/transfer`, { owner_id: ownerId }),
};
