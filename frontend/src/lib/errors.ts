/**
 * One failure, one sentence — in one place.
 *
 * Three pages had written their own version of this, and the versions had
 * drifted: one said "Unknown error", one named the missing permission, and one
 * appended the correlation id. Which of those a reader got depended on which
 * screen they were on, and only the third one is any use in a support ticket.
 *
 * So the rules are stated once:
 *
 * **A 403 says which privilege was missing**, when the server named it. "You
 * do not have permission" leaves somebody to guess whether to ask for access
 * or to stop asking; the permission label tells them what to request. `action`
 * names the verb, because "permission to export" tells a reader which of the
 * several things they just tried was the one refused.
 *
 * **Everything else carries the correlation id.** A screenshot of a failure
 * that includes it is a failure somebody can find in the log; one without it is
 * a support ticket that starts with "when did this happen?".
 *
 * **A non-`ApiError` gets the fallback**, because a `TypeError` from a render
 * is not a sentence anybody should be shown.
 */

import { ApiError } from "@/api/client";

export function errorText(
  error: unknown,
  { fallback = "Something went wrong.", action = "do that" }: ErrorTextOptions = {},
): string {
  if (error instanceof ApiError) {
    if (error.isForbidden) {
      const missing = error.missingPermissions;
      return missing.length
        ? `You do not have permission to ${action} (missing ${missing.join(", ")}).`
        : `You do not have permission to ${action}.`;
    }
    return `${error.message} · ${error.correlationId}`;
  }
  return error instanceof Error && error.message ? error.message : fallback;
}

export interface ErrorTextOptions {
  /** Shown when the failure is not one the API described. */
  fallback?: string;
  /** The verb a refusal should name — "export", "save this report". */
  action?: string;
}
