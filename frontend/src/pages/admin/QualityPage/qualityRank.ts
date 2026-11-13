import type { QualityFinding, QualityOverview, QualitySeverity } from "@/api/quality";
import { formatNumber } from "@/lib/formats";

/**
 * Severity → the AntD tag preset that carries it.
 *
 * A preset rather than one of our own hexes, for the reason the dashboard's
 * alert tags are: a custom colour makes AntD write white on the fill, and white
 * on our amber is 2.87:1 (§55).
 */
export const SEVERITY_TONE: Record<QualitySeverity, string> = {
  CRITICAL: "error",
  WARNING: "warning",
  INFO: "processing",
};

/**
 * The order findings are read in.
 *
 * By severity first and *count second*, because one contradiction matters more
 * than four hundred missing phone numbers — sorting by count would bury the
 * order that shipped and was never paid under the devices that are merely
 * quiet.
 */
const RANK: Record<QualitySeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

export function ranked(findings: QualityFinding[]): QualityFinding[] {
  return [...findings].sort(
    (left, right) => RANK[left.severity] - RANK[right.severity] || right.count - left.count,
  );
}

/** What the page says it looked at, in one sentence. */
export function summarise(overview: QualityOverview | undefined): string {
  if (!overview) return "";
  const { checks, failing, records } = overview.totals;
  if (failing === 0) {
    return `${checks} checks, and nothing to report`;
  }
  return `${checks} checks · ${failing} with something in them · ${formatNumber(records)} records`;
}
