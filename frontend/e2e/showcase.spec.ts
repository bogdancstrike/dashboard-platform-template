import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The two showcase pages against the real stack (§60, §61).
 *
 * The claims only a browser can make:
 *
 * **The gallery's links go somewhere.** Every layout links to real pages built
 * that way, and a gallery of dead links is worse than no gallery — this
 * follows one from each shape and checks the page it lands on renders. It is
 * also how `/search/saved/:id` was caught dropping the id it was given.
 *
 * **The components really render.** A showcase that type-checks and then
 * throws on mount is a showcase nobody sees, and the demonstrations are the
 * one place in the app where several components are mounted with no data
 * behind them.
 *
 * **No placeholder remains.** The last two pages in the navigation were
 * placeholders until now, so this walks every navigation entry the
 * administrator can see and asserts none of them says so.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

test("every shared component renders, and the page admits what it omits", async ({
  page,
}) => {
  await signIn(page, "admin", "/showcase/components");

  // The demonstrations mount for real — several components with no data
  // behind them, which is exactly where a showcase throws.
  await expect(page.getByTestId("demo-StatCard")).toBeVisible();
  await expect(page.getByTestId("demo-PageHeader")).toBeVisible();
  await expect(page.getByTestId("demo-EmptyState")).toBeVisible();
  await expect(page.getByTestId("demo-StatusTag")).toBeVisible();

  // And the coverage is published rather than implied: the inventory comes
  // from the directory, so this is the real gap or the real absence of one.
  await expect(page.getByTestId("coverage-gap")).toBeVisible();
  await expect(page.getByTestId("feature-note")).toContainText("components/mail");

  // The states that are decisions, not one happy path.
  const stat = page.getByTestId("demo-StatCard");
  await expect(stat).toContainText("a rise reads as bad news");
  await expect(stat).toContainText("the same arrow reads as good");
});

test("the page renders without a console error", async ({ page }) => {
  // A showcase mounts more components with no data than anything else in the
  // app, so it is the page most likely to warn.
  const problems: string[] = [];
  page.on("console", (event) => {
    if (event.type() === "error") problems.push(event.text());
  });
  page.on("pageerror", (error) => problems.push(String(error)));

  await signIn(page, "admin", "/showcase/components");
  await expect(page.getByTestId("demo-StatCard")).toBeVisible();
  expect(problems).toEqual([]);
});

test("the gallery lists every shape and says when each is wrong", async ({ page }) => {
  await signIn(page, "admin", "/showcase/templates");
  await expect(page.getByTestId("layouts")).toBeVisible();

  await expect(page.getByTestId("layout-list")).toBeVisible();
  await expect(page.getByTestId("layout-split")).toBeVisible();
  await expect(page.getByTestId("layout-wizard")).toBeVisible();

  // The half a gallery usually omits, on every card.
  const cards = page.getByTestId("layouts").locator(".nu-tmpl-card");
  const count = await cards.count();
  expect(count).toBeGreaterThan(8);
  for (let index = 0; index < count; index += 1) {
    await expect(cards.nth(index)).toContainText("Not when");
  }

  // And the mechanism, so a reader knows why to trust it.
  await expect(page.getByTestId("completeness")).toContainText("templates.test.ts");
});

test("the gallery's links land on pages that render", async ({ page }) => {
  await signIn(page, "admin", "/showcase/templates");
  await expect(page.getByTestId("layouts")).toBeVisible();

  // One per shape rather than all forty: enough to prove the links are real
  // addresses rather than decoration, without re-testing every page.
  for (const shape of ["list", "split", "board", "grid", "wizard", "canvas"]) {
    const first = page.getByTestId(`routes-${shape}`).locator("a").first();
    const href = await first.getAttribute("href");
    expect(href, shape).toBeTruthy();

    await page.goto(href!);
    // A gallery of dead links is worse than no gallery, so the landing page
    // has to actually render something.
    await expect(page.locator("#nu-main")).toBeVisible();
    await expect(page.locator("#nu-main")).not.toContainText("Page not found");

    // Navigated back explicitly rather than with `goBack`: several pages write
    // their own URL state on arrival, so the previous history entry is not
    // reliably the gallery — which made this fail on the third shape.
    await page.goto("/showcase/templates");
    await expect(page.getByTestId("layouts")).toBeVisible();
  }
});

test("no page in the platform is still a placeholder", async ({ page }) => {
  // The two showcase pages were the last of them, so this is a regression
  // guard: `PlaceholderPage` and its file are both gone.
  //
  // Walked from the *gallery* rather than from the sidebar, and that is the
  // interesting part: the sidebar is an AntD menu that navigates on click
  // rather than a list of anchors, so there are no hrefs in it to harvest —
  // which the first version of this test discovered by finding zero. The
  // gallery links to every classified route, and `templates.test.ts` proves
  // that set equals the router's, so walking the gallery *is* walking every
  // page — from a list something already keeps honest rather than a second
  // copy of the navigation.
  await signIn(page, "admin", "/showcase/templates");
  await expect(page.getByTestId("layouts")).toBeVisible();

  const hrefs = [
    ...new Set(
      (
        await page
          .locator(".nu-tmpl-link")
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href") ?? ""))
      ).filter((href) => href.startsWith("/")),
    ),
  ].sort();
  expect(hrefs.length, "the gallery listed no pages").toBeGreaterThan(30);

  const placeholders: string[] = [];
  for (const href of hrefs) {
    await page.goto(href);
    const main = page.locator("#nu-main");
    // A longer wait than the default, and the reason is the shape of this
    // test: every `goto` is a cold boot of the application behind a real
    // identity provider, and this does forty-six of them. One of those
    // exceeding fifteen seconds under a full-suite load is slowness, not a
    // placeholder — and failing on it reports the wrong thing. Caught exactly
    // that way, on a page still showing "Signing you in…".
    await expect(main, href).toBeVisible({ timeout: 45_000 });
    const text = (await main.textContent()) ?? "";
    if (/not built yet|placeholder/i.test(text)) placeholders.push(href);
  }
  expect(placeholders).toEqual([]);
});

test("both showcase pages are legible and keyboard-reachable", async ({ page }) => {
  for (const route of ["/showcase/components", "/showcase/templates"]) {
    await signIn(page, "admin", route);
    await expect(page.locator("#nu-main")).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );

    const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
    const serious = audit.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(
      serious.map((violation) => ({
        route,
        id: violation.id,
        nodes: violation.nodes.map(
          (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
        ),
      })),
    ).toEqual([]);
  }
});
