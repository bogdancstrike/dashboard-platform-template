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

/** Where a tab goes when re-authenticating is itself what is failing. */
export const SESSION_EXPIRED_PATH = "/errors/session-expired";

/**
 * Where the reader was going when the session ran out.
 *
 * Kept because the session-expired page has no memory of it, and signing in
 * again should not cost somebody their place: they asked for `/admin/tags` and
 * being signed out is not a reason to land on the dashboard. In
 * `sessionStorage` for the reason the sign-in stamp is — the recovery crosses
 * two page loads and a trip through the identity provider.
 */
const WANTED = "nu.auth.wanted";

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
  // Nothing is on its way out any more either: a credential that works ends
  // whatever this document had decided about leaving.
  leaving = false;
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
/**
 * Whether *this document* has already decided to leave.
 *
 * A page issues six requests at once. When the token has expired, all six
 * fail to refresh and all six ask to re-authenticate — and the first one has
 * already stamped `sessionStorage`, so the second reads its own stamp and
 * concludes it is in a loop. That is not a loop; it is one attempt seen twice.
 *
 * A loop is two attempts separated by a *page load*, which is exactly what
 * this flag distinguishes: a module variable dies with the document, so a
 * later document starts with a clean one and only the stamp survives.
 *
 * It went in after the guard sent an end-to-end run to
 * `/errors/session-expired` under load — the operator's replayed session
 * needed a refresh, six requests asked for it together, and the second one
 * declared a loop.
 */
let leaving = false;

export function recordSignInAttempt(now: number = Date.now()): "redirect" | "loop" | "already" {
  // Already on the way out. Whatever this call was going to do, the document
  // it would have done it in is being replaced.
  if (leaving) return "already";

  // Already *there*. The page whose job is to say "your session ended" must
  // not try to fix it: its own boot calls `/api/me`, which is refused for the
  // same reason, so re-authenticating would send the browser to this address
  // again — and again, and again. The page that exists for this state was
  // unreachable in it, which is the worst possible place for that bug.
  if (window.location.pathname === SESSION_EXPIRED_PATH) {
    leaving = true;
    return "already";
  }

  const previous = readLastSignIn();
  if (previous !== null && now - previous < LOOP_WINDOW_MS) {
    leaving = true;
    return "loop";
  }
  try {
    window.sessionStorage.setItem(LAST_SIGN_IN, String(now));
  } catch {
    // See `markSignedIn`.
  }
  leaving = true;
  return "redirect";
}

/** Test seam: a fresh document starts with nothing decided. */
export function resetSignInGuard(): void {
  leaving = false;
}

/**
 * Sign out of the identity provider, so the next sign-in is a *new* session.
 *
 * This is what the session-expired page's button has to do, and neither a
 * reload nor a forced login is it. Two facts make it so, and both were learned
 * from a real lockout:
 *
 * **Revocation is keyed on Keycloak's `sid`, which identifies the SSO
 * session** — not the token. `/settings/security`'s "sign out this device"
 * marks that row revoked, and every token carrying the id is refused
 * afterwards, which is the point.
 *
 * **A browser holding the SSO cookie cannot get a different `sid`.** A reload
 * re-authenticates silently into the same session. `prompt=login` asks for
 * credentials again and *still* reuses it — verified against a running
 * Keycloak, where `session_state` was unchanged across the forced login. So
 * the reader was refused, sent to this page, pressed the only button on it,
 * and was refused again: locked out of a platform they had just authenticated
 * to, with no way back but clearing cookies.
 *
 * Ending the SSO session is what breaks that. The browser comes back with no
 * session, `login-required` sends it to the form, and the new sign-in carries
 * an id no revocation names.
 *
 * The fuller answer is for revocation to end the Keycloak session at the same
 * time — a session the API considers dead and the identity provider considers
 * live is two answers to one question. That needs an administrative credential
 * the API does not have, and shipping one in a template's environment is its
 * own decision; it is recorded as open rather than done quietly.
 */
export async function signInAgain(): Promise<void> {
  resetSignInGuard();
  markSignedIn();
  const active = keycloak;
  if (active === null) {
    // Before the adapter exists — the boot screen. A reload is all there is,
    // and at boot there is no stale session to escape.
    window.location.assign("/");
    return;
  }
  // Back to what they asked for, not to the origin: being signed out is not a
  // reason to lose your place, and the page they are standing on is the error
  // page rather than anywhere they wanted to be.
  await active.logout({ redirectUri: `${window.location.origin}${_wanted()}` });
}

async function reauthenticate(client: Keycloak): Promise<void> {
  const decision = recordSignInAttempt();
  if (decision === "already") return;
  if (decision === "loop") {
    try {
      window.sessionStorage.setItem(
        WANTED,
        `${window.location.pathname}${window.location.search}`,
      );
    } catch {
      // See `markSignedIn`. Without it the reader lands on the dashboard,
      // which is a worse recovery rather than a broken one.
    }
    window.location.assign(SESSION_EXPIRED_PATH);
    return;
  }
  await client.login({ redirectUri: window.location.href });
}

function _wanted(): string {
  try {
    const path = window.sessionStorage.getItem(WANTED);
    window.sessionStorage.removeItem(WANTED);
    // Only a path of our own: an absolute URL from storage would be an open
    // redirect somebody could plant.
    return path && path.startsWith("/") && !path.startsWith("//") ? path : "/";
  } catch {
    return "/";
  }
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
