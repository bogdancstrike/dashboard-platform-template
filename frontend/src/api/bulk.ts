import { api } from "./client";
import type { ExplorerRequest } from "./explorer";

/**
 * One change over many records (§43, §75).
 *
 * Three things worth knowing before reading the types.
 *
 * **A selection is not a list of ids.** It is either a set of ids, or the
 * question the list was asking, or both — because that is what a reader
 * actually produces: they tick three rows, then press "select everything
 * matching", then untick one. `excluded` is what makes the last of those
 * expressible without sending four hundred and ninety-nine ids.
 *
 * **The query sent is the list's own request**, unchanged. Sending a
 * hand-built copy of the filters would be a second question, and the first
 * time the two disagreed somebody would change rows they never saw. The page
 * has an `ExplorerRequest` already; it goes as-is.
 *
 * **The result is two halves, and both are normal.** Fifty rows of which one
 * lost a race is forty-nine applied and one refused — not a failure, not a
 * success. The response carries `applied`, `unchanged` and a `failed` entry
 * per record with its reason, and the screen shows all three.
 */

/** What a bulk gesture may do. The server refuses anything else by name. */
export type BulkAction = "update" | "delete";

export interface BulkSelection {
  /** Rows ticked by hand. */
  ids?: string[];
  /** The list's own question — "everything matching what I am looking at". */
  query?: ExplorerRequest | null;
  /** Rows unticked out of a filter selection. */
  excluded?: string[];
}

export interface BulkRequest {
  action: BulkAction;
  selection: BulkSelection;
  /** For `update`: field → new value, validated by the form's declaration. */
  changes?: Record<string, unknown>;
}

/** A reason some rows cannot be touched, with how many. */
export interface BulkRefusal {
  reason: string;
  count: number;
}

export interface BulkPreview {
  resource_type: string;
  action: BulkAction;
  changes: Record<string, unknown>;
  total: number;
  /** Ticked by hand — trusted differently from the rest, hence separate. */
  by_hand: number;
  by_filter: number;
  limit: number;
  over_limit: boolean;
  /** A few of the actual records, so the count can be checked against names. */
  sample: Array<{ id: string; title: string }>;
  refused: BulkRefusal[];
  eligible: number;
  /** The selection in a sentence, for the confirmation somebody reads. */
  describes: string;
}

export interface BulkFailure {
  id: string;
  title: string;
  error: string;
  message: string;
}

export interface BulkResult {
  resource_type: string;
  action: BulkAction;
  requested: number;
  applied: number;
  /** Already had the value: not work done, and not a problem. */
  unchanged: number;
  failed: BulkFailure[];
  records: Array<{ id: string; title: string }>;
  message: string;
}

export const bulkApi = {
  /** What it would do, before it does it. Always called first. */
  preview(resourceType: string, body: BulkRequest, signal?: AbortSignal) {
    return api.post<BulkPreview>(`/api/records/${resourceType}/bulk/preview`, body, { signal });
  },
  apply(resourceType: string, body: BulkRequest, signal?: AbortSignal) {
    return api.post<BulkResult>(`/api/records/${resourceType}/bulk`, body, { signal });
  },
};
