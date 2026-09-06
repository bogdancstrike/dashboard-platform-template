import { api } from "./client";

import type { FieldKind } from "./explorer";

export interface RecordField {
  name: string;
  label: string;
  kind: FieldKind;
  value: unknown;
  /** Whether a form may write it, and the limits the server will enforce (§9). */
  editable?: boolean;
  required?: boolean;
  minimum?: number | null;
  maximum?: number | null;
  /** The dataset a foreign key points at, for the picker to read. */
  references?: string;
}

/** One record, as `services/records.py` publishes it (§8). */
export interface RecordDetail {
  id: string;
  resource_type: string;
  resource_label: string;
  /** Where this entity's list lives, for the back link. */
  path: string;
  title: string;
  subtitle: string;
  status: string;
  title_field: string;
  status_field: string;
  fields: RecordField[];
  /** Declared text fields to read as prose rather than table cells. */
  content_fields: string[];
  /** Extension attributes; secret-shaped keys are masked by the server. */
  metadata: Record<string, unknown>;
  created_at: string | null;
  updated_at: string | null;
  /** What this reader may do with it (§76). */
  can_edit: boolean;
  can_delete: boolean;
}

/**
 * What a form sends (§9).
 *
 * Only the fields it changed, plus the version it was editing. The server
 * refuses a write against a version that has since moved on, which is what
 * keeps two people editing one record from silently overwriting each other
 * (§73) — so a caller that read the record first should pass what it read.
 */
export type RecordChanges = Record<string, unknown> & {
  expected_updated_at?: string | null;
};

export const recordsApi = {
  get: (resourceType: string, id: string, signal?: AbortSignal) =>
    api.get<RecordDetail>(`/api/records/${resourceType}/${id}`, { signal }),

  create: (resourceType: string, changes: RecordChanges) =>
    api.post<RecordDetail>(`/api/records/${resourceType}`, changes),

  update: (resourceType: string, id: string, changes: RecordChanges) =>
    api.put<RecordDetail>(`/api/records/${resourceType}/${id}`, changes),

  remove: (resourceType: string, id: string) =>
    api.delete<{ id: string; deleted: boolean; title: string }>(
      `/api/records/${resourceType}/${id}`,
    ),
};
