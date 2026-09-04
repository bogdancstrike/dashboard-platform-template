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
  workers: process.env["CI"] ? 1 : undefined,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
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
