import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against the **real stack** — `docker compose up`, with
 * Keycloak and the seeded database behind it. Not a mock. The whole point of
 * this level is to catch what unit and component tests structurally cannot: a
 * broken production bundle, a proxy that does not route, a token the API
 * refuses.
 *
 * `BASE_URL` points at the compose frontend by default. Set it to the Vite dev
 * server (http://localhost:5174 is both, so usually nothing to change) or to a
 * deployed environment.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  // Capped rather than left to the machine. Playwright defaults to half the
  // cores — sixteen browsers on a 32-core laptop — against one API container
  // with two gevent workers and one Keycloak. Test parallelism that outruns
  // the system under test produces flakes that read exactly like product bugs,
  // and chasing those costs more than the minute the cap adds.
  //
  // Three rather than four since the suite passed a hundred tests: the ones
  // that failed at four were sign-ins timing out — Keycloak, not the product —
  // and a suite whose failures are about its own concurrency teaches people to
  // rerun rather than to read.
  workers: process.env["CI"] ? 1 : Number(process.env["E2E_WORKERS"] ?? 3),
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],
  // 60s rather than 30. A test that fails on a wrong value fails in
  // milliseconds; this cap only ever binds on the slow-under-load path —
  // signing in, or the relationship graph, whose communities are computed
  // server-side over the whole dataset. It was binding inside a `beforeEach`,
  // which aborts the whole serial group and reports four tests as "did not
  // run": one contended request, five red lines, none of them a product bug.
  timeout: 60_000,
  // 30s, raised from 15 and before that from 10, and each time for the same
  // observed reason: every failure this cap has ever produced was a *timeout
  // under load* — most often a page still showing "Signing you in…" — and
  // never a wrong value. The suite is now 316 tests against one API container
  // with two workers and one Keycloak, and most of them boot the application
  // cold at least once; three of those boots exceeding fifteen seconds in a
  // three-minute run is the tail of that, not a product bug, and it reported
  // itself as one in three different specs.
  //
  // It costs nothing on the passing path: an expectation that will pass
  // resolves in milliseconds. What it costs is the speed at which a genuine
  // hang is reported, and `timeout` above still bounds that.
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env["BASE_URL"] ?? "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Signs every persona in once and stores the session; see e2e/auth.setup.ts.
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      use: { ...devices["Desktop Chrome"], storageState: ".auth/admin.json" },
    },
  ],
});
