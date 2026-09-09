import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The command palette against the real stack (§31, §54).
 *
 * The keyboard route to anywhere: two ways in, a record found by its own
 * reference, a destination, and an action the current page contributed. All
 * four are things only a browser can check — the chord is a window listener,
 * the record search is the server's, and "on this page" depends on which page
 * is mounted.
 */

test.use({ storageState: storageStateFor("admin") });

const CHORD = "ControlOrMeta+k";

function palette(page: Page) {
  return page.getByPlaceholder(/Search pages, records and actions/);
}

test("the chord opens it, and Escape closes it", async ({ page }) => {
  await signIn(page, "admin", "/tasks");

  await page.keyboard.press(CHORD);
  await expect(palette(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(palette(page)).toBeHidden();
});

test("a bare slash opens it, and a slash inside a field does not", async ({ page }) => {
  await signIn(page, "admin", "/tasks");

  await page.keyboard.press("/");
  await expect(palette(page)).toBeVisible();
  await page.keyboard.press("Escape");

  // The list's own search box: a slash typed there is a slash, because `/` is
  // a character and the palette must not take it out of somebody's sentence.
  // By placeholder: AntD's `Input.Search` renders `type="search"`, whose
  // role is `searchbox` rather than `textbox`.
  const search = page.getByPlaceholder(/Search tasks/);
  await search.click();
  await search.pressSequentially("and/or");
  await expect(palette(page)).toBeHidden();
  await expect(search).toHaveValue("and/or");
});

test("the chord still works while typing in a field", async ({ page }) => {
  await signIn(page, "admin", "/tasks");
  await page.getByPlaceholder(/Search tasks/).click();

  await page.keyboard.press(CHORD);

  // A chord is not a character: the search box is exactly where somebody
  // already typing what they are looking for is.
  await expect(palette(page)).toBeVisible();
});

test("a record is reached by its own reference, in one gesture", async ({ page }) => {
  await signIn(page, "admin", "/dashboard");
  await page.keyboard.press(CHORD);

  await palette(page).fill("TSK-00042");
  const hit = page.locator("[cmdk-item]").filter({ hasText: "TSK-00042" }).first();
  await expect(hit).toBeVisible();
  await hit.click();

  // Its own page, not a filtered list: the reader asked for a record.
  await expect(page).toHaveURL(/\/tasks\/[0-9a-f-]{36}/);
  await expect(page.locator("#nu-main")).toContainText("TSK-00042");
});

test("a destination is one search away", async ({ page }) => {
  await signIn(page, "admin", "/tasks");
  await page.keyboard.press(CHORD);

  await palette(page).fill("audit");
  await page.locator("[cmdk-item]").filter({ hasText: "Audit" }).first().click();

  await expect(page).toHaveURL(/\/admin\/audit/);
});

test("the current page's own actions are the first group", async ({ page }) => {
  await signIn(page, "admin", "/tickets");
  await page.keyboard.press(CHORD);

  // The heading names where the reader is, and the actions are the ones the
  // ticket queue registered — a palette offering them from the billing screen
  // is a palette people stop trusting.
  await expect(page.locator("[cmdk-group-heading]").first()).toContainText("Tickets");
  const first = page.locator("[cmdk-group]").first();
  await expect(first.locator("[cmdk-item]").first()).toBeVisible();
});

test("a reader is offered only the destinations their role allows", async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStateFor("viewer") });
  const page = await context.newPage();
  await signIn(page, "viewer", "/dashboard");

  await page.keyboard.press(CHORD);
  await palette(page).fill("audit");

  // The same permission the navigation reads: the palette is a second door to
  // the same rooms, not a way round the lock (§76).
  await expect(page.locator("[cmdk-item]").filter({ hasText: "Audit" })).toHaveCount(0);
  await context.close();
});

test("the palette is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/tasks");
  await page.keyboard.press(CHORD);
  await palette(page).fill("task");
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

  const audit = await new AxeBuilder({ page }).include("[cmdk-root]").analyze();
  const serious = audit.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => `${node.target.join(" ")} :: ${node.failureSummary}`),
    })),
  ).toEqual([]);
});
