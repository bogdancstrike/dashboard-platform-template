import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

import { signIn } from "./auth";

/**
 * The first e2e suite: does the *built* application actually run in a browser?
 *
 * This exists because of a bug no other level could have caught. The unit
 * tests passed, the component tests passed, typecheck was clean and the build
 * succeeded — and the deployed page was blank, because a `manualChunks` split
 * put `rc-resize-observer` in one chunk and the `resize-observer-polyfill` it
 * constructs in another. The bundler produced a cycle, the constructor was
 * undefined when called, and the only symptom was a console error.
 *
 * So: every test here fails on an unexpected console error, and the first one
 * does nothing else.
 */

/** Noise that is not the application's fault and not worth failing on. */
const IGNORED = [
  /favicon/i,
  /Download the React DevTools/i,
  // React 18 + AntD 5: AntD's compatible-version warning on React 19 only.
  /\[antd: compatible\]/i,
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (IGNORED.some((pattern) => pattern.test(text))) return;
    errors.push(`console.error: ${text}`);
  });

  // An uncaught exception never reaches console.error in every browser, so it
  // is captured separately — this is the channel the chunking bug used.
  page.on("pageerror", (error: Error) => {
    errors.push(`uncaught: ${error.message}`);
  });

  return errors;
}

test.describe("the application boots", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("renders without a single console error", async ({ page }) => {
    const errors = collectErrors(page);

    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    // Let anything asynchronous settle before judging the console.
    await page.waitForLoadState("networkidle");

    expect(errors, `browser reported:\n${errors.join("\n")}`).toEqual([]);
  });

  test("shows the service metadata the API published", async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto("/admin/health");

    await expect(page.getByText("Nucleus", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("template-spa")).toBeVisible();
    await expect(page.getByText("http://localhost:8080/realms/template")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("lists every dependency with a live status", async ({ page }) => {
    await page.goto("/admin/health");

    // Straight from /platform/health/status, through nginx, against the real
    // PostgreSQL, Redis and Keycloak in the stack.
    await expect(page.getByRole("cell", { name: "database" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "cache" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "identity" })).toBeVisible();
    await expect(page.getByText("healthy").first()).toBeVisible();
  });

  test("a deep link is served by the SPA, not a 404", async ({ page }) => {
    // §69: a URL pasted from a colleague has to work, not only one navigated to.
    await page.goto("/admin/audit");
    await expect(page).toHaveURL(/\/admin\/audit$/);
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
  });

  test("the API is reachable on the app's own origin", async ({ page, baseURL }) => {
    // No CORS, no preflight, no API URL in the bundle.
    const response = await page.request.get(`${baseURL}/platform/meta/app`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.name).toBe("Nucleus");
    expect(body.auth.realm).toBe("template");
  });
});

/**
 * Appearance is stored per user on the server (§40), so these tests inherit
 * whatever the previous run left behind. Each therefore reads the current
 * value and switches to the other one rather than assuming a starting state —
 * a test that only passes on a pristine account is a test that fails on the
 * second run.
 */
test.describe("appearance", () => {
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page }) => signIn(page));

  test("density survives a reload", async ({ page }) => {
    const html = page.locator("html");
    const target = (await html.getAttribute("data-density")) === "compact"
      ? "comfortable"
      : "compact";

    await page.getByRole("button", { name: /Open the command palette/ }).click();
    await page.getByText(`Use ${target} density`, { exact: true }).click();
    await expect(html).toHaveAttribute("data-density", target);

    await page.reload();
    await expect(html).toHaveAttribute("data-density", target);
  });

  test("the theme survives a reload and reaches the document", async ({ page }) => {
    const html = page.locator("html");
    const target = (await html.getAttribute("data-theme")) === "dark" ? "light" : "dark";

    await page.getByRole("button", { name: /Open the command palette/ }).click();
    await page.getByText(`Switch to the ${target} theme`, { exact: true }).click();
    await expect(html).toHaveAttribute("data-theme", target);

    await page.reload();
    await expect(html).toHaveAttribute("data-theme", target);
    // The browser paints form controls and scrollbars from this, so a dark page
    // with a white scrollbar means it was never set.
    await expect(html).toHaveCSS("color-scheme", target);
  });
});
