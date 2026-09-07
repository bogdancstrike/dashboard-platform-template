import { request, type APIRequestContext } from "@playwright/test";

import { PERSONAS, type Persona } from "./auth";

/**
 * A signed-in API caller, for *cleanup* rather than for assertions.
 *
 * Every claim in this suite is made through the browser, because that is where
 * the product is. Cleanup is the exception. Removing a row through the UI is a
 * second flow with its own modals and its own ways to fail, and when it fails
 * it leaves the row behind — which is how twenty `Chart e2e …` reports came to
 * fill the page somebody took a screenshot of. A sweep that is one request per
 * leftover cannot be defeated by an overlay that had not finished fading.
 *
 * The realm's SPA client allows the direct grant (`keycloak/realm-template.json`),
 * so a token is one request and needs no browser at all.
 */

const KEYCLOAK = process.env["KEYCLOAK_URL"] ?? "http://localhost:8080";
const API = process.env["API_URL"] ?? "http://localhost:5101/platform/api";

/** A bearer token for one of the seeded personas. */
async function tokenFor(persona: Persona): Promise<string> {
  const account = PERSONAS[persona];
  const context = await request.newContext();
  try {
    const response = await context.post(
      `${KEYCLOAK}/realms/template/protocol/openid-connect/token`,
      {
        form: {
          client_id: "template-spa",
          grant_type: "password",
          username: account.username,
          password: account.password,
        },
      },
    );
    if (!response.ok()) {
      throw new Error(`Keycloak refused the direct grant: ${response.status()}`);
    }
    return ((await response.json()) as { access_token: string }).access_token;
  } finally {
    await context.dispose();
  }
}

/**
 * An API context that carries `persona`'s token on every request.
 *
 * No `baseURL`: Playwright resolves a request path against it with `new URL`,
 * so a leading slash replaces the whole path and `/reports` against
 * `…/platform/api` asks for `…/reports`. That 404s, and a sweep whose list
 * request quietly fails is a sweep that deletes nothing — which is the exact
 * failure this file exists to prevent. Callers use `endpoint()` instead.
 */
export async function apiAs(persona: Persona = "admin"): Promise<APIRequestContext> {
  const token = await tokenFor(persona);
  return request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

/** An absolute API address, so no path is resolved against anything. */
export function endpoint(path: string): string {
  return `${API}${path}`;
}

/**
 * Delete every saved report whose name starts with one of `prefixes`.
 *
 * Unconditional by design: called from `afterEach`, it runs whether the test
 * passed, failed or timed out, which is the only version of cleanup that keeps
 * a shared database usable. Reports created by a *different* persona are left
 * alone — a sweep that could delete a colleague's row would be a worse problem
 * than the one it solves.
 */
export async function sweepReports(prefixes: string[], persona: Persona = "admin"): Promise<void> {
  const api = await apiAs(persona);
  try {
    const response = await api.get(endpoint("/reports"), { params: { page_size: 200 } });
    // Loud rather than silent: a sweep that cannot list is a sweep that
    // deletes nothing, and it would look exactly like a clean run.
    if (!response.ok()) {
      throw new Error(`Could not list reports to sweep: ${response.status()}`);
    }
    const { items } = (await response.json()) as { items: { id: string; name: string }[] };
    for (const report of items) {
      if (!prefixes.some((prefix) => report.name.startsWith(prefix))) continue;
      await api.delete(endpoint(`/reports/${report.id}`));
    }
  } finally {
    await api.dispose();
  }
}
