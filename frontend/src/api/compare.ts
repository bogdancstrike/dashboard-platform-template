import { api } from "./client";

/**
 * Two or more records side by side (§47).
 *
 * Two things worth knowing before reading the types.
 *
 * **The fields that agree are here too.** They are the evidence that two
 * records are the same thing, which is the commonest reason anybody opens this
 * view — a comparison that only ever shows differences cannot answer "are these
 * duplicates". The page hides them on request rather than the server omitting
 * them.
 *
 * **`differs` is computed on the value the page draws**, not on the ORM
 * attribute. `Decimal("10.00")` and `Decimal("10.0")` are not equal in Python
 * and are the same money.
 */

export interface ComparedRecord {
  id: string;
  title: string;
  path: string;
  status: string | null;
}

export interface ComparedField {
  name: string;
  label: string;
  kind: string;
  /** One per record, in the order the records were asked for. */
  values: unknown[];
  differs: boolean;
}

export interface Comparison {
  resource_type: string;
  resource_label: string;
  path: string;
  records: ComparedRecord[];
  fields: ComparedField[];
  differing: number;
  same: number;
  /** The most records the server will put side by side. */
  limit: number;
}

export const compareApi = {
  records: (resourceType: string, ids: string[], signal?: AbortSignal) =>
    api.get<Comparison>(`/api/records/${resourceType}/compare`, {
      params: { ids: ids.join(",") },
      signal,
    }),
};
