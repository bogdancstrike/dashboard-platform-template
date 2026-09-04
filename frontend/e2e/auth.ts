import { expect, type Page } from "@playwright/test";

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
  await page.goto(path);

  const username = page.locator('input[name="username"]');
  const banner = page.getByRole("banner").getByText(account.name, { exact: true });
  await expect(username.or(banner).first()).toBeVisible();

  if (await username.isVisible()) {
    await username.fill(account.username);
    await page.locator('input[name="password"]').fill(account.password);
    await page.getByRole("button", { name: "Sign In" }).click();
  }

  await page.waitForURL((url) => url.port === "5174");
  await expect(banner).toBeVisible();
}
