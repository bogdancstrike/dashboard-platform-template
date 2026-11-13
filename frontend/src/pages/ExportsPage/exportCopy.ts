import type { ExportCatalogue, ExportEstimate, ExportRow, ExportStatus } from "@/api/exports";
import { formatNumber } from "@/lib/formats";

/** How often to look again while something is still being produced. */
export const WHILE_WORKING_MS = 2_000;

/**
 * What one export's row actually means, in a sentence.
 *
 * The whole argument of this page. Six statuses and three derived flags
 * collapse into four situations, and which one a row is in decides whether
 * somebody waits, acts, or does nothing. "Failed" and "nothing is going to
 * pick this up" both leave a person with no file, and only one of them is
 * worth waiting for.
 */
export function situation(row: ExportRow): string {
  if (row.stalled) {
    return "Stopped without finishing — nothing is going to pick it up";
  }
  if (row.status === "QUEUED") return "Waiting to start";
  if (row.status === "RUNNING" || row.status === "RETRYING") return "Being produced";
  if (row.status === "FAILED") return "Failed";
  if (row.status === "CANCELLED") return "Cancelled";
  if (row.expired) return "Finished — the file was kept for its retention window and has gone";
  if (!row.downloadable) return "Finished — the file has been discarded";
  return "Ready to download";
}

/**
 * The colour a row earns, and the reason most rows get none.
 *
 * Only two things on this page are worth colouring: a file somebody can take
 * away, and a row that needs them. Everything else — waiting, cancelled,
 * expired — is ordinary, and a list where every line is coloured is a list
 * where the colour says nothing (§64).
 */
export function tone(row: ExportRow): "success" | "error" | "warning" | undefined {
  if (row.stalled) return "warning";
  if (row.status === "FAILED") return "error";
  if (row.status === "SUCCEEDED" && row.downloadable) return "success";
  return undefined;
}

/** Whether this row is one the page should keep looking at. */
export function working(row: ExportRow): boolean {
  return !row.stalled && ["QUEUED", "RUNNING", "RETRYING"].includes(row.status);
}

/**
 * What the drawer should offer for a query of this size, and why.
 *
 * Returned as a sentence rather than a boolean pair so the page and its tests
 * agree on the *reason*: "1,284 rows — small enough to download straight
 * away" and "184,203 rows — too many for this installation" lead to two
 * different buttons, and a reader deserves to know which before they press
 * one.
 */
export function advice(estimate: ExportEstimate): string {
  const rows = formatNumber(estimate.rows);
  if (estimate.rows === 0) return "Nothing matches this query yet.";
  if (estimate.too_large) {
    return `${rows} rows — more than this installation exports (${formatNumber(
      estimate.maximum,
    )}). Narrow the query.`;
  }
  if (estimate.can_stream) {
    return `${rows} rows — small enough to download straight away.`;
  }
  return `${rows} rows — too many to download in one request, so this becomes a background export.`;
}

export const STATUS_LABELS: Record<ExportStatus, string> = {
  QUEUED: "Queued",
  RUNNING: "Running",
  RETRYING: "Retrying",
  SUCCEEDED: "Finished",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/** The header's one sentence: what is here, and what the limits are. */
export function summary(catalogue: ExportCatalogue | undefined): string {
  if (!catalogue) return "Exports you have asked for, and the files they became.";
  if (catalogue.total === 0) {
    return `Any list can be exported. Downloads stop at ${formatNumber(
      catalogue.streams_up_to,
    )} rows; larger ones are produced in the background.`;
  }
  const ready =
    catalogue.ready === 1 ? "1 file ready to download" : `${catalogue.ready} files ready`;
  return `${ready}. Files are kept for ${catalogue.retention_days} days.`;
}

export function countLabel(count: number | undefined): string {
  return typeof count === "number" ? `(${count})` : "";
}
