import { api } from "./client";

/** How a field moved. "added" and "cleared" are not the same event. */
export type ChangeKind = "added" | "changed" | "cleared";

export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
  kind: ChangeKind;
}

/** A ledger row: who / when / what, without the diff behind it. */
export interface AuditRow {
  id: string;
  occurred_at: string;
  action: string;
  result: string;
  resource_type: string;
  resource_id: string | null;
  resource_label: string;
  actor_id: string | null;
  actor_label: string;
  actor_role: string;
  impersonated: boolean;
  impersonator_label: string;
  correlation_id: string;
  message: string;
  changed_field_count: number;
}

/** One entry in full — the row, the request context, and the diff. */
export interface AuditEntry extends AuditRow {
  ip_address: string;
  user_agent: string;
  organization_id: string | null;
  metadata: Record<string, unknown>;
  state_before: Record<string, unknown>;
  state_after: Record<string, unknown>;
  changed_fields: string[];
  changes: AuditChange[];
}

export interface AuditField {
  name: string;
  label: string;
  kind: string;
  sortable: boolean;
  filterable: boolean;
  searchable: boolean;
  facet: boolean;
  operators: string[];
  choices: string[];
}

export interface AuditCatalogue {
  fields: AuditField[];
  default_columns: string[];
  default_sort: string;
  actions: string[];
  results: string[];
  total: number;
}

export interface AuditPage {
  items: AuditRow[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
  sort: string;
  order: string;
  fields: AuditField[];
  facets: Record<string, { value: string; count: number }[]>;
  columns: string[];
}

export interface AuditTimelinePage {
  items: AuditEntry[];
  total: number;
  resource_type: string;
  resource_id: string;
  limit: number;
}

/**
 * The filters the explorer sends.
 *
 * Indexed as well as named: the client serialises `params` generically, and a
 * closed interface cannot be handed to it without a cast that would also
 * silence a genuine mistake.
 */
export interface AuditQuery extends Record<string, unknown> {
  page?: number;
  page_size?: number;
  sort?: string;
  order?: "asc" | "desc";
  q?: string;
  action?: string[] | string;
  result?: string[] | string;
  resource_type?: string[] | string;
  actor_label?: string;
  correlation_id?: string;
  resource_id?: string;
  impersonated?: string;
  occurred_at_from?: string;
  occurred_at_to?: string;
}

export const auditApi = {
  catalogue: (signal?: AbortSignal) =>
    api.get<AuditCatalogue>("/admin/audit/catalog", { signal }),

  list: (params: AuditQuery, signal?: AbortSignal) =>
    api.get<AuditPage>("/admin/audit", { params, signal }),

  entry: (id: string, signal?: AbortSignal) =>
    api.get<AuditEntry>(`/admin/audit/${id}`, { signal }),

  /**
   * Every recorded action against one record.
   *
   * A lesser permission than the ledger, which is what lets an entity detail
   * page show its own history to somebody who may read the record but not the
   * whole audit trail.
   */
  timeline: (
    params: { resource_type: string; resource_id: string; limit?: number },
    signal?: AbortSignal,
  ) => api.get<AuditTimelinePage>("/api/audit/timeline", { params, signal }),
};
