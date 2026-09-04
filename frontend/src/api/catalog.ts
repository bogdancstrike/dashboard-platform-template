import { api } from "./client";

import type { FieldKind } from "./explorer";

/**
 * The data catalogue (§65).
 *
 * Generated from the same resource declarations the explorer and the query
 * builder read, so an entry cannot describe a field that does not exist or
 * omit one that does.
 */
export interface CatalogField {
  name: string;
  label: string;
  kind: FieldKind;
  filterable: boolean;
  sortable: boolean;
  searchable: boolean;
  facet: boolean;
  choices: string[];
  operators: string[];
  /** Records carrying a value for this field. */
  filled: number;
  /** That, as a percentage of the dataset — measured, not asserted. */
  completeness: number;
}

export interface CatalogNote {
  level: "info" | "warning";
  message: string;
}

export interface CatalogDataset {
  key: string;
  label: string;
  description: string;
  permission: string;
  record_count: number;
  default_sort: string;
  default_columns: string[];
  updated_at: string | null;
  created_at: string | null;
  searchable_fields: string[];
  facet_fields: string[];
  fields: CatalogField[];
  notes: CatalogNote[];
}

export interface Catalog {
  items: CatalogDataset[];
  total: number;
  field_count: number;
  record_count: number;
}

export interface FieldValues {
  resource_type: string;
  field: string;
  label: string;
  values: Array<{ value: string; count: number }>;
}

export const catalogApi = {
  datasets: (signal?: AbortSignal) => api.get<Catalog>("/api/catalog/datasets", { signal }),
  /** The values a field actually holds, most common first. */
  values: (resourceType: string, field: string, signal?: AbortSignal) =>
    api.get<FieldValues>(`/api/catalog/datasets/${resourceType}`, { params: { field }, signal }),
};
