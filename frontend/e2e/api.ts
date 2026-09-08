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

/**
 * Tokens, cached per persona for the life of the worker.
 *
 * Not an optimisation. The realm ships with `bruteForceProtected` enabled —
 * which is the right default and the reason `auth.ts` signs each persona in
 * once and replays the cookies — and an `afterEach` that asks Keycloak for a
 * fresh token on every test in three spec files asks for a few hundred of
 * them. Keycloak starts treating that as a quick-login attack, tokens come
 * back slowly or not at all, and the failures land on whichever spec happened
 * to be running: a rotating set of "product bugs" that are nothing of the
 * kind.
 *
 * A token lasts minutes and the suite runs in minutes, so one per persona per
 * worker is enough. If one does expire mid-run the sweep's own error says so
 * loudly rather than silently deleting nothing.
 */
const tokens = new Map<Persona, Promise<string>>();

/** A bearer token for one of the seeded personas. */
function tokenFor(persona: Persona): Promise<string> {
  const cached = tokens.get(persona);
  if (cached) return cached;
  const fresh = requestToken(persona);
  tokens.set(persona, fresh);
  // A failed request must not be cached, or every later sweep inherits it.
  void fresh.catch(() => tokens.delete(persona));
  return fresh;
}

async function requestToken(persona: Persona): Promise<string> {
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
 * Delete every dashboard whose name starts with one of `prefixes`.
 *
 * Through the API for the same reason reports are, plus one of its own: the
 * UI sweep this replaced clicked a Delete button and then waited on a
 * confirmation modal, and under the full suite's load that wait expired often
 * enough to fail tests that had already passed. Cleanup that can fail a
 * passing test has its purpose inverted.
 */
export async function sweepDashboards(
  prefixes: string[],
  persona: Persona = "admin",
): Promise<void> {
  const api = await apiAs(persona);
  try {
    const response = await api.get(endpoint("/dashboards"), { params: { page_size: 200 } });
    if (!response.ok()) {
      throw new Error(`Could not list dashboards to sweep: ${response.status()}`);
    }
    const { items } = (await response.json()) as { items: { id: string; name: string }[] };
    for (const board of items) {
      if (!prefixes.some((prefix) => board.name.startsWith(prefix))) continue;
      await api.delete(endpoint(`/dashboards/${board.id}`));
    }
  } finally {
    await api.dispose();
  }
}

/**
 * Delete every saved search whose name starts with one of `prefixes`.
 *
 * This file had no sweep, and it showed: leftovers from failed runs piled up
 * on the panel until one whose random suffix happened to contain the letters
 * "ok" made `getByRole("button", {name: "OK"})` match five elements. Playwright
 * matches an accessible name by substring unless told otherwise — so the
 * locator was wrong too — but a panel that fills up with a previous run's rows
 * will find the next such coincidence on its own.
 */
export async function sweepSavedSearches(
  names: string[],
  persona: Persona = "admin",
): Promise<void> {
  if (names.length === 0) return;
  const wanted = new Set(names);
  const api = await apiAs(persona);
  try {
    const response = await api.get(endpoint("/saved-searches"), { params: { page_size: 200 } });
    if (!response.ok()) {
      throw new Error(`Could not list saved searches to sweep: ${response.status()}`);
    }
    const { items } = (await response.json()) as { items: { id: string; name: string }[] };
    for (const search of items) {
      // Exact names, not a prefix. These tests run in parallel, and a sweep
      // that deleted every "E2E search …" row deleted the *sibling* test's
      // fixture while it was still using it — the explorer then showed every
      // record and the failure read as "the saved search did not restore its
      // question", which is a product bug it never had.
      if (!wanted.has(search.name)) continue;
      await api.delete(endpoint(`/saved-searches/${search.id}`));
    }
  } finally {
    await api.dispose();
  }
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
