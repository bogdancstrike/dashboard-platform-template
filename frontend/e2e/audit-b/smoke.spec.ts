import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { storageStateFor } from "../auth";

/**
 * UI/UX audit B, as a regression guard: every page in the records, find,
 * administration, data, template, account and error areas loads at desk and
 * phone width with no console error, no sideways page scroll, and no axe
 * violation inside the page itself.
 *
 * One test per route and width, so a failure names the page. The crawl that
 * found what these guard against — every dropdown, modal and button used in
 * turn, light and dark, three widths — is `e2e/audit-b/scan.mjs` and
 * `interact.mjs`; this is the part cheap enough to run on every change.
 *
 * The shell (sidebar, header, phone tab bar) is excluded from the axe pass:
 * it is the same on every page and `a11y.spec` audits it once, so counting it
 * here would report one defect sixty times and hide the page's own.
 */

test.use({ storageState: storageStateFor("admin") });

const ENTITIES = { projects: "project", customers: "customer", orders: "order", tickets: "ticket", devices: "device" } as const;

const STATIC_ROUTES = [
  ...Object.keys(ENTITIES).flatMap((e) => [`/${e}`, `/${e}/grid`]),
  "/explore",
  "/find/global",
  "/find/relationships",
  "/find/catalog",
  "/favorites",
  "/admin",
  "/admin/users",
  "/admin/groups",
  "/admin/roles",
  "/admin/organizations",
  "/admin/audit",
  "/admin/logs",
  "/admin/jobs",
  "/admin/health",
  "/admin/api",
  "/admin/integrations",
  "/admin/flags",
  "/admin/settings",
  "/admin/sla",
  "/admin/forms",
  "/admin/quality",
  "/admin/tags",
  "/import",
  "/exports",
  "/showcase/components",
  "/showcase/templates",
  "/profile",
  "/settings/preferences",
  "/settings/security",
  "/compare",
  "/errors/401",
  "/errors/403",
  "/errors/404",
  "/errors/500",
  "/errors/maintenance",
  "/errors/session-expired",
  "/errors/switched-off",
];

/** Console noise that is about the harness or the dev server, not the page. */
const IGNORED = [/Download the React DevTools/, /\[vite\]/, /React Router Future Flag/, /favicon/];

/**
 * Rules this audit does not yet hold every page to, each with the reason.
 * Shrink this list; never grow it to make a red run green.
 */
const KNOWN = [
  // AntD's horizontally scrolling table body is not focusable; fixing it is a
  // change to the shared table skin (reported to the shell owner).
  "scrollable-region-focusable",
  // AntD's own hidden measuring row for sticky/scrolling tables.
  "aria-hidden-focus",
];

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector(".ant-spin-spinning, .ant-skeleton-active"), undefined, {
      timeout: 10_000,
    })
    .catch(() => undefined);
  await page
    .waitForFunction(
      () => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity),
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => undefined);
}

async function audit(page: Page, route: string): Promise<void> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!IGNORED.some((pattern) => pattern.test(text))) errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto(route);
  await expect(page.locator("#nu-main")).toBeVisible();
  await settle(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(1);

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .include("#nu-main")
    .exclude(".ant-tooltip")
    .disableRules(KNOWN)
    .analyze();
  const violations = results.violations.map(
    (v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`,
  );
  expect(violations, "axe violations inside the page").toEqual([]);
  expect(errors, "console errors").toEqual([]);
}

let detailRoutes: string[] = [];

test.beforeAll(async ({ browser }) => {
  // The page's own bearer token rather than a password grant: the realm can
  // refuse direct grants (password sign-in switched off), and a signed-in
  // page always has one.
  const page = await browser.newPage({ storageState: storageStateFor("admin") });
  let token = "";
  page.on("request", (request) => {
    const header = request.headers()["authorization"];
    if (header?.startsWith("Bearer ") && request.url().includes("/platform/")) token = header.slice(7);
  });
  await page.goto("/home");
  await expect(page.locator("#nu-main")).toBeVisible();
  await expect.poll(() => token).not.toBe("");
  const found: string[] = [];
  for (const [path, resource] of Object.entries(ENTITIES)) {
    const response = await page.request.post("/platform/api/explorer/query", {
      headers: { Authorization: `Bearer ${token}` },
      data: { resource_type: resource, page: 1, page_size: 1 },
    });
    if (!response.ok()) continue;
    const body = (await response.json()) as { items: { id: string }[] };
    if (body.items[0]) found.push(`/${path}/${body.items[0].id}`);
  }
  await page.close();
  detailRoutes = found;
});

for (const width of [
  { name: "desk", viewport: { width: 1440, height: 900 } },
  { name: "phone", viewport: { width: 390, height: 844 } },
]) {
  test.describe(`audit B at ${width.name} width`, () => {
    test.use({ viewport: width.viewport });

    for (const route of STATIC_ROUTES) {
      test(`${route} is clean`, async ({ page }) => {
        await audit(page, route);
      });
    }

    test("every record page is clean", async ({ page }) => {
      test.slow();
      expect(detailRoutes.length, "one record of each kind to open").toBe(Object.keys(ENTITIES).length);
      for (const route of detailRoutes) await audit(page, route);
    });
  });
}
