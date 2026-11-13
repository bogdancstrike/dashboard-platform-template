import type { Job, JobStatus } from "@/api/jobs";

/** The three things `jobs.manage` can do to a job. */
export type Verb = "retry" | "cancel" | "grant";

/**
 * The colour a status earns.
 *
 * Never the only carrier (§64): the status is written out beside it. RETRYING
 * gets the warning tone rather than the error one on purpose — "failed and
 * will be tried again" is a different state from "failed", and an operator
 * scanning for what needs them should not be pulled to a row already handling
 * itself.
 */
export function toneFor(status: JobStatus): string | undefined {
  switch (status) {
    case "FAILED":
      return "error";
    case "RETRYING":
      return "warning";
    case "SUCCEEDED":
      return "success";
    case "RUNNING":
      return "processing";
    case "QUEUED":
      return "default";
    default:
      return undefined;
  }
}

/**
 * Why a control is unavailable, in the words an operator needs.
 *
 * Exported and asserted directly, because this *is* the §76 rule for this
 * page: a disabled button whose tooltip says "not allowed" has told nobody
 * anything, and the two reasons a retry is refused are genuinely different
 * problems with different fixes.
 */
export function whyNot(job: Job, action: "retry" | "cancel"): string | null {
  if (action === "retry") {
    if (job.can_retry) return null;
    // Checked before the attempt count, because it is the reason that stands
    // whatever the attempts say: an export is re-requested rather than
    // retried, and telling somebody to grant it more attempts would send them
    // after a fix that changes nothing (§30).
    if (job.kind === "EXPORT") {
      return "Exports are re-requested rather than retried — the rows have moved on since this one was asked for. Ask again on the Exports page.";
    }
    if (job.attempt >= job.max_attempts) {
      return job.can_allow_attempts
        ? `All ${job.max_attempts} attempts have been used. Grant it more to run it again.`
        : `All ${job.max_attempts} attempts have been used, and that is the most one job may be granted.`;
    }
    return `It is ${job.status.toLowerCase()} and has not finished — retrying now would run it twice over the same records.`;
  }
  if (job.can_cancel) return null;
  return `It already finished as ${job.status.toLowerCase()}. There is nothing left to stop.`;
}

/** How a job's own progress reads, in words as well as a bar. */
export function progressLabel(job: Job): string {
  if (job.total_units === 0) return `${job.progress}%`;
  const done = job.processed_units.toLocaleString();
  const total = job.total_units.toLocaleString();
  return job.failed_units > 0
    ? `${done} of ${total}, ${job.failed_units.toLocaleString()} failed`
    : `${done} of ${total}`;
}

/** Milliseconds, in the largest unit that keeps it readable. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
