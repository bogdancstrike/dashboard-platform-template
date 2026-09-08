/** Runtime-configured Keycloak adapter.
 *
 * Nothing deployment-specific is compiled into the bundle. The adapter is
 * created only after `/meta/app` publishes the realm's public URL and client
 * id, then every API request asks it for a fresh-enough token.
 */

import Keycloak from "keycloak-js";

import { setTokenProvider, setUnauthorizedHandler } from "@/api/client";
import type { AppMeta } from "@/api/meta";

let keycloak: Keycloak | null = null;

export async function initializeAuth(meta: AppMeta): Promise<void> {
  if (keycloak) return;

  const client = new Keycloak({
    url: meta.auth.url,
    realm: meta.auth.realm,
    clientId: meta.auth.client_id,
  });
  const authenticated = await client.init({
    onLoad: "login-required",
    pkceMethod: "S256",
    checkLoginIframe: false,
  });

  if (!authenticated) {
    await client.login({ redirectUri: window.location.href });
    return;
  }

  keycloak = client;

  setTokenProvider(async () => {
    const active = requireClient();
    try {
      await active.updateToken(30);
    } catch {
      await reauthenticate(active);
      return null;
    }
    return active.token ?? null;
  });

  setUnauthorizedHandler(() => {
    void reauthenticate(requireClient());
  });

  // Refresh immediately on expiry as well as lazily before requests. This
  // keeps WebSocket reconnects and long-idle tabs from holding a stale token.
  client.onTokenExpired = () => {
    void client.updateToken(30).catch(() => reauthenticate(client));
  };
}

/**
 * How recently this tab was already sent through the sign-in page, in ms.
 *
 * `sessionStorage` and not a module variable: the redirect *replaces the
 * document*, so a counter in memory is reset by the very thing it exists to
 * count. Per-tab rather than shared, because two tabs re-authenticating at
 * once are not evidence of a loop.
 */
const LAST_SIGN_IN = "nu.auth.last-sign-in";

/**
 * A quarter of a minute. Long enough to cover a real round trip through
 * Keycloak — redirect, consent-free reissue, redirect back, one API call —
 * and short enough that somebody whose token genuinely expires twice in a
 * session is refreshed silently both times rather than shown a page.
 */
const LOOP_WINDOW_MS = 15_000;

/** Signals the loop guard that a sign-in round trip completed successfully. */
export function markSignedIn(): void {
  try {
    window.sessionStorage.removeItem(LAST_SIGN_IN);
  } catch {
    // Private mode, or storage disabled. The guard degrades to letting the
    // redirect happen, which is what used to happen unconditionally.
  }
}

/**
 * Whether to send the reader through sign-in again, or to stop and say so.
 *
 * The unguarded version — `login()` on every 401 — has one failure mode, and
 * it is the worst one in the product: when the credential Keycloak issues is
 * refused by the API anyway, the tab redirects, comes back, calls the API,
 * gets a 401, and redirects again, forever, showing nothing. A revoked
 * `UserSession` (§41), a clock skew past the token's leeway, or a realm whose
 * audience no longer matches all produce exactly that, and all three look
 * identical from the browser: a page that flashes.
 *
 * So the second attempt inside the window stops. A page naming an ended
 * session is one somebody can act on; an infinite redirect is a bug report
 * that reads "it flashes".
 *
 * Separated from the redirect itself, and it takes `now`, so the window can be
 * tested without a Keycloak instance or a real clock. It records the attempt
 * as a side effect — named `record…` rather than `should…` for that reason.
 */
export function recordSignInAttempt(now: number = Date.now()): "redirect" | "loop" {
  const previous = readLastSignIn();
  if (previous !== null && now - previous < LOOP_WINDOW_MS) return "loop";
  try {
    window.sessionStorage.setItem(LAST_SIGN_IN, String(now));
  } catch {
    // See `markSignedIn`.
  }
  return "redirect";
}

/** Where a tab goes when re-authenticating is itself what is failing. */
export const SESSION_EXPIRED_PATH = "/errors/session-expired";

async function reauthenticate(client: Keycloak): Promise<void> {
  if (recordSignInAttempt() === "loop") {
    window.location.assign(SESSION_EXPIRED_PATH);
    return;
  }
  await client.login({ redirectUri: window.location.href });
}

function readLastSignIn(): number | null {
  try {
    const raw = window.sessionStorage.getItem(LAST_SIGN_IN);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function signOut(): Promise<void> {
  return requireClient().logout({ redirectUri: window.location.origin });
}

function requireClient(): Keycloak {
  if (!keycloak) throw new Error("Authentication has not been initialized.");
  return keycloak;
}
