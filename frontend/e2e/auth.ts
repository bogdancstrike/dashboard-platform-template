import { expect, type Page } from "@playwright/test";

import { rememberToken } from "./api";

export const PERSONAS = {
  admin: { username: "admin", password: "admin", name: "Ada Administrator" },
  manager: { username: "manager", password: "manager", name: "Mara Manager" },
  operator: { username: "operator", password: "operator", name: "Otto Operator" },
  analyst: { username: "analyst", password: "analyst", name: "Ana Analyst" },
  viewer: { username: "user", password: "user", name: "Uma User" },
} as const;

export type Persona = keyof typeof PERSONAS;

/** The last bearer token each page was seen using — who the page really is. */
const seen = new WeakMap<Page, string>();
/** Pages that already have the listener, so it is attached exactly once. */
const watched = new WeakSet<Page>();

/**
 * Where a persona's signed-in browser state is cached between runs.
 *
 * The realm ships with `bruteForceProtected` enabled, which is the right
 * default for a template and also means Keycloak treats several logins for one
 * account inside a second as a quick-login attack and refuses them all. Signing
 * in once per persona in the `setup` project and replaying the cookies is both
 * the fix and the faster suite: every later test starts already authenticated.
 */
export function storageStateFor(persona: Persona): string {
  return `.auth/${persona}.json`;
}

/**
 * Sign in through the real Keycloak login form and land on `path`.
 *
 * The redirect to the identity provider is issued by `keycloak-js` *after* the
 * SPA has booted, not by the server: `page.goto()` therefore resolves while the
 * browser is still on the app's own origin. Deciding what to do by reading
 * `page.url()` at that moment is a race that silently skips the login form and
 * fails later on a missing banner. Waiting for whichever of the two outcomes
 * appears — the login form, or the shell of an already-established session —
 * removes the race without a fixed sleep, and makes this usable both for the
 * cold sign-in in `auth.setup.ts` and for a test replaying a stored session.
 */
export async function signIn(
  page: Page,
  persona: Persona = "admin",
  path = "/dashboard",
): Promise<void> {
  const account = PERSONAS[persona];

  // Catch the bearer token the app is already using, so the cleanup helpers
  // never have to ask Keycloak for one of their own. The realm ships with
  // `bruteForceProtected` enabled — correctly — and a suite that requests a
  // few hundred direct grants gets 401s that land on whichever spec happens
  // to be running. This costs nothing: the header is on every API request the
  // page makes anyway.
  //
  // **A token is filed under whoever it belongs to, read from the token.**
  // The first version filed it under the persona `signIn` was *called* with,
  // which is a different thing: the chromium project carries the
  // administrator's stored session, so a page that has never signed in is
  // already somebody and no login form appears. `signIn(page, "manager")`
  // then left the page as the administrator and cached the administrator's
  // token under "manager" — and every later `apiAs("manager")` in that worker
  // made a manager's request with an administrator's credential. Two
  // permission tests asserted 403 and 404 and got 200, depending on which
  // spec had run first in the worker. The token says whose it is; nothing
  // else has to.
  if (!watched.has(page)) {
    watched.add(page);
    page.on("request", (request) => {
      const header = request.headers()["authorization"];
      if (!header?.startsWith("Bearer ") || !request.url().includes("/platform/")) return;
      const token = header.slice("Bearer ".length);
      seen.set(page, token);
      const owner = personaOf(subjectOf(token));
      if (owner) rememberToken(owner, token);
    });
  }

  await page.goto(path);

  const username = page.locator('input[name="username"]');
  /**
   * That the shell is up and knows who this is — at any width.
   *
   * The reader's *name* in the header was the witness, and the header hides it
   * below `lg`: a phone shows the avatar and nothing else. So every test that
   * set a mobile viewport before signing in timed out here, which is why the
   * suite had exactly one assertion at mobile width (§56). The profile button
   * carries the same fact and is there at every width.
   */
  const banner = page.getByRole("banner").getByRole("button", { name: "Open profile menu" });
  // The third outcome, and it is a real one rather than a failure: this
  // persona's session may have been revoked by `security.spec`, and a browser
  // still holding the identity provider's cookie re-authenticates silently
  // into the *same* session — same id, refused again. The platform lands on
  // its own session-expired page, whose button forces a fresh authentication
  // (`keycloak.signInAgain`). Clicking it is what a person does, and it is the
  // only way back in short of clearing cookies.
  const expired = page.getByTestId("problem-session_expired");
  // Its own, longer deadline. Signing in is the *slowest* thing in the suite
  // and the only one that is slow for reasons outside the product: the SPA
  // boots, redirects to Keycloak, exchanges a code and then waits on
  // `/api/me`. With several workers against one API container and one
  // Keycloak, that tail runs past the global expectation cap — and the failure
  // lands as "the page never rendered", which reads like a product bug and is
  // not one. Raising the global cap instead would slow down every genuine
  // failure.
  //
  // 90s rather than 45, and the extra half has a named cause: `security.spec`
  // asserts that signing out everywhere else keeps the session that asked, and
  // it does that as the *operator* — which revokes the operator's stored
  // browser session too. Any later spec signing that persona in therefore pays
  // a full re-authentication: two SPA boots and a Keycloak round trip rather
  // than a replayed cookie. `tags.spec` did, three sweeps in a row, and
  // reported it as a page that never rendered.
  await expect(username.or(banner).or(expired).first()).toBeVisible({ timeout: 90_000 });

  if (await expired.isVisible()) {
    await page.getByTestId("problem-signin").click();
    await expect(username.or(banner).first()).toBeVisible({ timeout: 90_000 });
  }

  if (await username.isVisible()) {
    await username.fill(account.username);
    await page.locator('input[name="password"]').fill(account.password);
    await page.getByRole("button", { name: "Sign In" }).click();
  }

  await page.waitForURL((url) => url.port === "5174");
  await expect(banner).toBeVisible({ timeout: 90_000 });

  // **And it is really this persona**, or the test says so loudly.
  //
  // A page carrying somebody else's stored session never sees a login form,
  // so this used to pass while asserting a lesser role's experience *as the
  // administrator* — a test that cannot fail. Repairing it here would mean
  // signing out and back in through Keycloak in the middle of a page's life,
  // which races the SPA's own redirect and broke seven specs when I tried;
  // naming it is better, because the fix belongs in the spec:
  // `test.use({ storageState: storageStateFor(persona) })`.
  const token = seen.get(page);
  const who = token ? subjectOf(token) : "";
  expect(
    who,
    `this page is signed in as "${who || "nobody"}" rather than "${account.username}" — ` +
      "add test.use({ storageState: storageStateFor(persona) }) to the describe",
  ).toBe(account.username);
}

/** The `preferred_username` in a bearer token, without asking anybody. */
function subjectOf(token: string): string {
  const [, payload] = token.split(".");
  if (!payload) return "";
  try {
    const decoded = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
    ) as { preferred_username?: string };
    return decoded.preferred_username ?? "";
  } catch {
    return "";
  }
}

/** Which seeded persona a username belongs to, if any. */
function personaOf(username: string): Persona | null {
  const found = Object.entries(PERSONAS).find(([, account]) => account.username === username);
  return (found?.[0] as Persona | undefined) ?? null;
}

