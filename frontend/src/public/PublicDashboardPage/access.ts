import { ApiError } from "@/api/client";
import type { PublicDashboard } from "@/api/recordsAnalytics";

export const GRANT_KEY = (token: string) => `nucleus.share.${token}`;

export function storedGrant(token: string): string | null {
  try {
    return sessionStorage.getItem(GRANT_KEY(token));
  } catch {
    return null;
  }
}

/** The origin of the page framing this one, when it is framed. */
export function embeddingOrigin(): string | null {
  if (window.self === window.top) return null;
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins;
  if (ancestors && ancestors.length) return ancestors[0]!;
  try {
    return document.referrer ? new URL(document.referrer).origin : "unknown";
  } catch {
    return "unknown";
  }
}

export type State =
  | { kind: "loading" }
  | { kind: "locked"; name: string; error?: string }
  | { kind: "ready"; data: PublicDashboard }
  | { kind: "gone"; title: string; detail: string };

/** A failed load, as the page that explains it. */
export function failure(error: unknown): State {
  if (error instanceof ApiError) {
    const raw = error.details["reason"];
    const reason = typeof raw === "string" ? raw : "";
    if (error.status === 404) return { kind: "gone", title: "This link does not exist", detail: "Check the address, or ask the person who shared it for a new one." };
    if (error.status === 410 && reason === "expired") return { kind: "gone", title: "This link has expired", detail: "Ask the person who shared it for a new link." };
    if (error.status === 410) return { kind: "gone", title: "This link is no longer available", detail: error.message };
    if (error.status === 403) return { kind: "gone", title: "This dashboard cannot be shown here", detail: "Its owner has not allowed it to be embedded on this site." };
    if (error.status === 429) return { kind: "gone", title: "Too many requests", detail: "Wait a minute and reload the page." };
  }
  return { kind: "gone", title: "Could not load this dashboard", detail: error instanceof Error ? error.message : "Try again later." };
}
