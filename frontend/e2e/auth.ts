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
  page.on("request", (request) => {
    const header = request.headers()["authorization"];
    if (header?.startsWith("Bearer ") && request.url().includes("/platform/")) {
      rememberToken(persona, header.slice("Bearer ".length));
    }
  });

  await page.goto(path);

  const username = page.locator('input[name="username"]');
  const banner = page.getByRole("banner").getByText(account.name, { exact: true });
  // Its own, longer deadline. Signing in is the *slowest* thing in the suite
  // and the only one that is slow for reasons outside the product: the SPA
  // boots, redirects to Keycloak, exchanges a code and then waits on
  // `/api/me`. With three workers against one API container and one Keycloak,
  // that tail runs past the global expectation cap — and the failure lands as
  // "the page never rendered", which reads like a product bug and is not one.
  // Raising the global cap instead would slow down every genuine failure.
  await expect(username.or(banner).first()).toBeVisible({ timeout: 45_000 });

  if (await username.isVisible()) {
    await username.fill(account.username);
    await page.locator('input[name="password"]').fill(account.password);
    await page.getByRole("button", { name: "Sign In" }).click();
  }

  await page.waitForURL((url) => url.port === "5174");
  await expect(banner).toBeVisible({ timeout: 45_000 });
}
