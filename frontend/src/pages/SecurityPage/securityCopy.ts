import type { SecurityOverview, SecuritySeverity, SessionState, SignInSession } from "@/api/security";
import { formatNumber } from "@/lib/formats";

/**
 * The sentence the page opens with.
 *
 * One sentence rather than four counters, because the question is "is anything
 * wrong" and a row of numbers makes the reader answer it themselves. Ordered
 * by what would worry somebody: failed sign-ins first, then unresolved
 * warnings, then how many devices are signed in.
 */
export function headline(overview: SecurityOverview): string {
  if (overview.failures_worth_saying) {
    const where = overview.failure_addresses.length
      ? ` from ${overview.failure_addresses.length === 1 ? "an address" : "addresses"} including ${overview.failure_addresses[0]}`
      : "";
    return `${formatNumber(overview.failed_sign_ins)} failed sign-ins in the last ${
      overview.window_days
    } days${where}. If none of those were you, sign out everywhere and change your password.`;
  }
  if (overview.unresolved_events) {
    return overview.unresolved_events === 1
      ? "One security event has not been looked at."
      : `${formatNumber(overview.unresolved_events)} security events have not been looked at.`;
  }
  if (overview.other_sessions) {
    return overview.other_sessions === 1
      ? "You are signed in on one other device. Nothing else needs attention."
      : `You are signed in on ${formatNumber(
          overview.other_sessions,
        )} other devices. Nothing else needs attention.`;
  }
  return "This is the only device you are signed in on, and nothing needs attention.";
}

/** Whether that sentence is a warning or a reassurance. */
export function headlineTone(overview: SecurityOverview): "error" | "warning" | "success" {
  if (overview.failures_worth_saying) return "error";
  if (overview.unresolved_events) return "warning";
  return "success";
}

/**
 * What one session's state comes to, in words.
 *
 * Three states and the one that matters is the difference between "somebody
 * signed this out" and "this ran out on its own" — a page saying "inactive"
 * for both would hide the only one anybody acted on.
 */
export function sessionSituation(row: SignInSession): string {
  if (row.current) return "This device, right now";
  if (row.state === "REVOKED") return "Signed out";
  if (row.state === "EXPIRED") return "Expired on its own";
  return row.trusted ? "Signed in — a device you recognise" : "Signed in";
}

/**
 * The colour a session earns, and why an ordinary one earns none.
 *
 * Only the one you are using is worth marking, plus an untrusted live session
 * — which is the row somebody scans for. Revoked and expired are ordinary
 * history, and colouring them would spend the reader's attention on rows
 * nothing can be done about (§64).
 */
export function sessionTone(row: SignInSession): "success" | "warning" | undefined {
  if (row.current) return "success";
  if (row.state === "ACTIVE" && !row.trusted) return "warning";
  return undefined;
}

/** A security event's severity as AntD names its colours. */
export function severityTone(severity: SecuritySeverity): string | undefined {
  return { CRITICAL: "error", WARNING: "warning", INFO: undefined }[severity];
}

export const STATE_LABELS: Record<SessionState, string> = {
  ACTIVE: "Signed in",
  EXPIRED: "Expired",
  REVOKED: "Signed out",
};
