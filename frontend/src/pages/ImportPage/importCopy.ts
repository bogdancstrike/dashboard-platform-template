import type { ImportCatalogue, ImportRun, ImportStatus, ImportTarget } from "@/api/imports";
import { formatNumber } from "@/lib/formats";

/** How often to look again while an execute is in flight. */
export const WHILE_RUNNING_MS = 1_500;

/** The four steps, in the order the decision has parts. */
export const STEPS = [
  { key: "UPLOAD", title: "File" },
  { key: "MAPPING", title: "Columns" },
  { key: "PREVIEW", title: "Check" },
  { key: "DONE", title: "Done" },
] as const;

/**
 * Which step a run is on, as an index into the strip.
 *
 * Read from the run's stored `step` rather than inferred from its data, which
 * is the whole reason that column exists: a draft whose mapping happens to be
 * complete has still not been *looked at*, and skipping it past the check
 * would defeat the point of the wizard.
 */
export function stepIndex(run: ImportRun | undefined): number {
  if (!run) return 0;
  if (run.step === "EXECUTE") return 3;
  const found = STEPS.findIndex((entry) => entry.key === run.step);
  return found < 0 ? 0 : found;
}

/**
 * What one run's numbers come to, in a sentence.
 *
 * The page's whole argument. Four counts and six statuses collapse into the
 * one thing a reader needs: whether to act, wait, or read the report. Stated
 * as a function so it can be asserted directly — the distinction between
 * "nothing in this file is usable" and "some of it is" decides whether the
 * execute button should exist at all.
 */
export function outcome(run: ImportRun): string {
  if (run.status === "DRAFT") {
    return run.unmapped_required.length
      ? `Needs a column for ${run.unmapped_required.join(", ")}`
      : `${formatNumber(run.total_rows)} rows read — check the columns`;
  }
  if (run.status === "RUNNING") return "Importing now";
  if (run.status === "CANCELLED") return "Discarded";
  if (run.status === "FAILED") {
    // All-or-nothing, so the useful fact is that nothing landed — not how far
    // it got.
    return "Failed — nothing was imported";
  }
  if (run.status === "COMPLETED") {
    return `${formatNumber(run.imported_rows)} of ${formatNumber(run.total_rows)} rows imported`;
  }
  if (run.valid_rows === 0) return "Nothing in this file can be imported";
  if (run.invalid_rows > 0) {
    return `${formatNumber(run.valid_rows)} ready, ${formatNumber(
      run.invalid_rows,
    )} to fix`;
  }
  return `${formatNumber(run.valid_rows)} ${run.valid_rows === 1 ? "row" : "rows"} ready to import`;
}

/**
 * The colour a run earns, and why most earn none.
 *
 * Only two things here are worth colouring: a file with problems somebody has
 * to fix, and one that finished. Draft, discarded and running are ordinary,
 * and a list where every line is coloured says nothing (§64).
 */
export function tone(run: ImportRun): "success" | "error" | "warning" | undefined {
  if (run.status === "FAILED") return "error";
  if (run.status === "COMPLETED") return "success";
  if (run.status === "VALIDATED" && run.invalid_rows > 0) return "warning";
  return undefined;
}

export const STATUS_LABELS: Record<ImportStatus, string> = {
  DRAFT: "Draft",
  VALIDATED: "Checked",
  RUNNING: "Importing",
  COMPLETED: "Imported",
  FAILED: "Failed",
  CANCELLED: "Discarded",
};

/** Why the execute is refused, in the words the tooltip shows. */
export function whyNotExecute(run: ImportRun): string {
  if (run.unmapped_required.length) {
    return `Choose a column for ${run.unmapped_required.join(", ")} first.`;
  }
  if (run.status === "DRAFT") return "Check the rows first.";
  if (run.status === "RUNNING") return "This import is running.";
  if (run.status === "COMPLETED") return "This file has already been imported.";
  if (run.valid_rows <= 0) {
    return "No row in this file is valid, so there is nothing to import.";
  }
  return "";
}

export function fieldLabel(target: ImportTarget, name: string): string {
  return target.fields.find((field) => field.name === name)?.label ?? name;
}

/** The header's one sentence: what this page does and what it will not take. */
export function summary(catalogue: ImportCatalogue | undefined): string {
  if (!catalogue) return "Load records from a spreadsheet.";
  const datasets = catalogue.targets.length;
  return `Load records from a CSV into any of ${datasets} datasets. Up to ${formatNumber(
    catalogue.max_rows,
  )} rows, checked row by row before anything is written.`;
}

