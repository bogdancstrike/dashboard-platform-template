/** Record version history (§17): the versions of one record and restoring one. */

import { api } from "../client";

export interface VersionField {
  name: string;
  label: string;
  kind: string;
  references: string;
}

export interface RecordVersion {
  id: string;
  number: number;
  at: string;
  action: string;
  actor: string;
  actor_id: string | null;
  message: string;
  changed: string[];
  restored_from: number | null;
  state: Record<string, unknown>;
}

export interface VersionHistory {
  resource_type: string;
  record_id: string;
  title: string;
  fields: VersionField[];
  versions: RecordVersion[];
  current: number;
  as_of: number | null;
  references: Record<string, Record<string, string>>;
  can_restore: boolean;
  updated_at: string | null;
}

export interface RestoreResult {
  restored: string[];
  version: number;
  message: string;
  history: VersionHistory;
}

export const versionsApi = {
  history: (type: string, id: string, at?: string | null, signal?: AbortSignal) =>
    api.get<VersionHistory>(`/api/records/${type}/${id}/versions`, { params: { at: at || undefined }, signal }),
  restore: (type: string, id: string, body: { version: number; fields?: string[]; expected_updated_at?: string | null }) =>
    api.post<RestoreResult>(`/api/records/${type}/${id}/versions/restore`, body),
};
