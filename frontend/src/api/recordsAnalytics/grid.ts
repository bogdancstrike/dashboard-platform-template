/** The bulk-edit grid (§18): many rows, each with its own changes. */

import { api } from "../client";

export interface GridRowResult {
  id: string;
  title: string;
  status: "applied" | "unchanged" | "failed";
  changed?: string[];
  problems: { field: string; message: string }[];
  error?: string;
  message?: string;
  updated_at?: string | null;
}

export interface GridSaveResult {
  resource_type: string;
  requested: number;
  applied: number;
  unchanged: number;
  failed: GridRowResult[];
  results: GridRowResult[];
  message: string;
}

export const gridApi = {
  /** Many rows, each with its own changes, through the records bulk API (§18). */
  save: (resourceType: string, rows: { id: string; changes: Record<string, unknown>; expected_updated_at?: string | null }[]) =>
    api.post<GridSaveResult>(`/api/records/${resourceType}/bulk`, { rows }),
};
