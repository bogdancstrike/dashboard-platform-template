import { test as setup } from "@playwright/test";

import { PERSONAS, signIn, storageStateFor, type Persona } from "./auth";

/**
 * One real sign-in per persona, saved for every test that follows.
 *
 * These run serially and before anything else (see the `setup` project in
 * `playwright.config.ts`). Keycloak's brute-force protection counts repeated
 * logins for one account inside a second as an attack and locks it for a
 * minute, so a suite where every test signs in for itself fails as soon as it
 * runs in parallel — which is the default. Signing in once and replaying the
 * SSO cookie also removes a full redirect round trip from every test.
 */
setup.describe.configure({ mode: "serial" });

for (const persona of Object.keys(PERSONAS) as Persona[]) {
  setup(`authenticate as ${persona}`, async ({ page }) => {
    await signIn(page, persona);
    await page.context().storageState({ path: storageStateFor(persona) });
  });
}
