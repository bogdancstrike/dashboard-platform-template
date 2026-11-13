import type { LogLevel } from "@/api/logs";

/** How often the tail asks, while it is running. */
export const POLL_MS = 4000;

/**
 * The colour a level is drawn in.
 *
 * Never the only carrier of the meaning (§64): the level is spelled out in the
 * cell beside it, so this is emphasis rather than information — which is what
 * lets a reader with no colour vision use the same table.
 */
export function toneFor(level: LogLevel): string | undefined {
  switch (level) {
    case "CRITICAL":
    case "ERROR":
      return "error";
    case "WARNING":
      return "warning";
    case "DEBUG":
      return undefined;
    default:
      return "success";
  }
}

/**
 * What a duration deserves to be called.
 *
 * Exported and asserted directly: the boundary between "fine" and "slow" is a
 * judgement, and a reader scanning a column of numbers needs the outliers to
 * announce themselves rather than being asked to compare 1,847 with 194.
 */
export function paceOf(ms: number | null): "quick" | "fine" | "slow" | "unknown" {
  if (ms === null) return "unknown";
  if (ms >= 1000) return "slow";
  if (ms >= 200) return "fine";
  return "quick";
}
