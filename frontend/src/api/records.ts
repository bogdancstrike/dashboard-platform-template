import { api } from "./client";

import type { FieldKind } from "./explorer";

export interface RecordField {
  name: string;
  label: string;
  kind: FieldKind;
  value: unknown;
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
  created_at: string | null;
  updated_at: string | null;
}

export const recordsApi = {
  get: (resourceType: string, id: string, signal?: AbortSignal) =>
    api.get<RecordDetail>(`/api/records/${resourceType}/${id}`, { signal }),
};
