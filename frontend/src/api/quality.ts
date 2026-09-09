import { api } from "./client";

/**
 * Data quality — what is wrong with the records (§65).
 *
 * Three things worth knowing before reading the types.
 *
 * **A `link` is the count's own question.** Each check is declared as the
 * filters a reader could type in the URL, so the address opens exactly the rows
 * that were counted. A count nobody can open is a count nobody can fix.
 *
 * **A check with no link says why.** `spent > budget` compares two columns and
 * the filter vocabulary compares a column to a value, by design — so those
 * checks publish a `sample` of records instead, and `why_no_link` explains it.
 * A link that quietly returned different rows would be worse than none.
 *
 * **The passing checks are part of the answer.** A page listing only problems
 * cannot be told apart from a page whose checks are broken, so every check is
 * returned with its count, including the zeroes.
 */

export type QualitySeverity = "CRITICAL" | "WARNING" | "INFO";

export interface QualityFinding {
  key: string;
  resource_type: string;
  resource_label: string;
  title: string;
  /** What goes wrong downstream if it is left. */
  why: string;
  /** What to do about it — a finding with no remedy is a complaint. */
  fix: string;
  severity: QualitySeverity;
  count: number;
  /** The list, narrowed to exactly these rows. Empty when a filter cannot say it. */
  link: string;
  why_no_link: string;
  sample: Array<{ id: string; label: string; path: string }>;
}

export interface QualitySummary {
  resource_type: string;
  failing: number;
  records: number;
  by_severity: Record<QualitySeverity, number>;
  /** The worst thing found, so a chip can be one colour rather than three. */
  worst: QualitySeverity | "";
}

export interface QualityDataset extends QualitySummary {
  label: string;
  path: string;
}

export interface QualityOverview {
  resource_type: string;
  generated_at: string;
  findings: QualityFinding[];
  totals: {
    checks: number;
    failing: number;
    records: number;
    by_severity: Record<QualitySeverity, number>;
  };
  datasets: QualityDataset[];
}

export const qualityApi = {
  overview: (params: { resource_type?: string } = {}, signal?: AbortSignal) =>
    api.get<QualityOverview>("/admin/quality", { params, signal }),
  /** Just the counts, for the indicator on a list page. */
  summary: (resourceType: string, signal?: AbortSignal) =>
    api.get<QualitySummary>(`/admin/quality/${resourceType}`, { signal }),
};
