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

/**
 * Keep the token a signed-in browser is using, so nothing here has to ask
 * Keycloak for one.
 *
 * Called from `signIn`, which sees it on every request the app makes. This is
 * what took the direct grant off the hot path entirely: with three workers and
 * several specs sweeping, even one grant per worker per persona was enough to
 * trip the realm's brute-force protection and start returning 401 — and the
 * failure landed on whichever test was running, never on the sweep that
 * caused it.
 */
export function rememberToken(persona: Persona, token: string): void {
  tokens.set(persona, Promise.resolve(token));
}

/**
 * A bearer token for one of the seeded personas.
 *
 * The browser's, when a `signIn` has happened in this worker; otherwise a
 * direct grant, which the realm allows for the SPA client and which is the
 * only option for a sweep that runs before anything has signed in.
 */
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
 * Put a task back in the lane it was taken from.
 *
 * The board spec moves a card between lanes and moved it back at the end of
 * the happy path — so a run that failed anywhere in between left the task
 * where it had dragged it. That is a *ratchet*: `NEW` lost one task per failed
 * run until it held none, after which every later run failed for want of a
 * card to drag, draining the lane further. Restoring through the API in an
 * unconditional `afterEach` is what breaks it.
 *
 * Found by reference rather than by id because the reference is what the card
 * shows; the lookup is the explorer's own query, so it cannot disagree with
 * the list the board drew.
 */
export async function restoreTaskStatus(
  reference: string,
  status: string,
  persona: Persona = "admin",
): Promise<void> {
  const api = await apiAs(persona);
  try {
    const found = await api.post(endpoint("/explorer/query"), {
      data: {
        resource_type: "task",
        filters: { reference },
        columns: ["reference", "status"],
        page_size: 1,
      },
    });
    if (!found.ok()) return;
    const { items } = (await found.json()) as { items: { id: string; status: string }[] };
    const task = items[0];
    if (!task || task.status === status) return;

    const current = await api.get(endpoint(`/records/task/${task.id}`));
    if (!current.ok()) return;
    const { updated_at } = (await current.json()) as { updated_at: string };
    await api.put(endpoint(`/records/task/${task.id}`), {
      // The same optimistic-concurrency contract every write uses (§73): a
      // restore that ignored the version would be the one write in the suite
      // that could clobber a concurrent edit.
      data: { status, expected_updated_at: updated_at },
    });
  } finally {
    await api.dispose();
  }
}

/**
 * Delete these boards, by id.
 *
 * By id and not by name prefix: the same mistake `sweepSavedSearches`
 * documents. A board takes its lanes and cards with it, which is the one place
 * a cascade is right — the board is the thing that was created.
 */
export async function sweepBoards(ids: string[], persona: Persona = "admin"): Promise<void> {
  if (ids.length === 0) return;
  const api = await apiAs(persona);
  try {
    for (const id of ids) {
      await api.delete(endpoint(`/kanban/boards/${id}`));
    }
  } finally {
    await api.dispose();
  }
}

/** Change a board — used to share one so a colleague can try to read it. */
export async function updateBoard(
  id: string,
  input: Record<string, unknown>,
  persona: Persona = "admin",
): Promise<void> {
  const api = await apiAs(persona);
  try {
    const response = await api.put(endpoint(`/kanban/boards/${id}`), { data: input });
    if (!response.ok()) {
      throw new Error(`Could not update the board: ${response.status()} ${await response.text()}`);
    }
  } finally {
    await api.dispose();
  }
}

/**
 * Publish a notice, and hand back its id.
 *
 * Written through the API rather than through the drawer because these tests
 * are about what the *reader* sees: driving an author's form first would make
 * every one of them a test of the form as well, and a failure there would read
 * as a failure of the noticeboard.
 *
 * Not `page.evaluate(fetch(...))`, which was the first attempt: the SPA holds
 * its bearer token in memory and adds the header itself, so a bare `fetch`
 * from the page is unauthenticated — and in an `afterEach` the page may
 * already be on `about:blank`, where a relative URL cannot even be parsed.
 */
export async function writeAnnouncement(
  notice: Record<string, unknown>,
  persona: Persona = "admin",
): Promise<string> {
  const api = await apiAs(persona);
  try {
    const response = await api.post(endpoint("/announcements"), {
      data: {
        body: "Written by the end-to-end suite.",
        category: "NEWS",
        severity: "INFO",
        status: "PUBLISHED",
        publish_at: new Date(Date.now() - 60_000).toISOString(),
        ...notice,
      },
    });
    if (!response.ok()) {
      throw new Error(`Could not write the notice: ${response.status()} ${await response.text()}`);
    }
    return ((await response.json()) as { id: string }).id;
  } finally {
    await api.dispose();
  }
}

/**
 * Delete these notices, by id.
 *
 * By id and not by title prefix, which was the first version: these tests run
 * in parallel and a prefix sweep in one test's `afterEach` deleted a sibling's
 * notice while it was still reading it — the board then showed nothing and the
 * failure read as "acknowledging did not survive a reload". The same mistake
 * `sweepSavedSearches` documents, made twice.
 */
export async function sweepAnnouncements(
  ids: string[],
  persona: Persona = "admin",
): Promise<void> {
  if (ids.length === 0) return;
  const api = await apiAs(persona);
  try {
    for (const id of ids) {
      await api.delete(endpoint(`/announcements/${id}`));
    }
  } finally {
    await api.dispose();
  }
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
