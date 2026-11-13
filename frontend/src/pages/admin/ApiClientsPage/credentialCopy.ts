import type { Credential, CredentialState } from "@/api/apiClients";
import { relativeTime } from "@/lib/time";

/**
 * The tone a credential's state earns.
 *
 * EXPIRED is a warning and not an error: a key that ran out is usually a
 * rotation nobody finished, which needs somebody's attention rather than an
 * alarm. REVOKED is neither — it is a decision somebody made, and colouring it
 * red would put every deliberate act on the same footing as a fault (§64).
 */
export function stateTone(state: CredentialState): string | undefined {
  switch (state) {
    case "ACTIVE":
      return "success";
    case "EXPIRED":
      return "warning";
    default:
      return undefined;
  }
}

/**
 * What a credential's dates come to, in words.
 *
 * Exported and asserted directly because a date on its own is not an answer:
 * "expires 2026-09-15" needs the reader to know today's date and do the
 * subtraction, and the thing they actually want to know is whether there is
 * time to redeploy.
 */
export function credentialStory(credential: Credential, now = new Date()): string {
  if (credential.state === "REVOKED") {
    return credential.revoked_at
      ? `Revoked ${relativeTime(credential.revoked_at)}`
      : "Revoked";
  }
  if (credential.expires_at === null) {
    return credential.last_used_at
      ? `Last used ${relativeTime(credential.last_used_at)}`
      : "Never used";
  }
  const expires = new Date(credential.expires_at);
  if (credential.state === "EXPIRED") {
    return `Expired ${relativeTime(credential.expires_at)}`;
  }
  const days = Math.ceil((expires.getTime() - now.getTime()) / 86_400_000);
  return days <= 1 ? "Expires today — redeploy now" : `Expires in ${days} days`;
}
