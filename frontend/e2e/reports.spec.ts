import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * Saved reports against the real stack (§28, §5).
 *
 * Two things a component test cannot show: a report built in the browser is
 * still there — and still answers — after a reload, and a private one is
 * invisible to somebody else's session.
 *
 * Serial, and each test cleans up after itself: reports are rows in a shared
 * database, and a suite that leaves five "Playwright report" entries behind
 * makes the next run's list assertions meaningless.
 */
test.describe.configure({ mode: "serial" });

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name: label }) })
    .locator(".ant-select-selector")
    .click();
  // The dropdown option, not the closed select's own label: AntD gives both the
  // same `title`, so this matches twice as soon as the value being chosen is
  // already the current one — which is the state a re-run leaves behind.
  await page.locator(".ant-select-item-option").filter({ hasText: option }).first().click();
}

/**
 * Remove every report this suite created, so the dataset ends where it began.
 *
 * All of them, not one: a run that fails before its own cleanup leaves a row
 * behind, and the next run's "is it in the list?" assertion then matches two
 * things and fails for a reason that has nothing to do with the product.
 */
async function deleteReports(page: Page, prefix: string): Promise<void> {
  await page.goto("/reports");
  // Wait for the list to arrive before counting. `count()` does not
  // auto-wait, so a loop that starts on an empty page decides there is
  // nothing to clean and leaves every row behind.
  await expect(page.getByTestId("reports")).toBeVisible();
  await expect(page.locator(".nu-queue-row").first()).toBeVisible();

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rows = page.locator(".nu-queue-row", { hasText: prefix });
    if ((await rows.count()) === 0) return;
    const row = rows.first();
    const name = ((await row.locator(".nu-queue-title").textContent()) ?? "").trim();
    await row.click();
    await page.getByRole("button", { name: `Actions for ${name}` }).click();
    await page.getByRole("menuitem", { name: /Delete/ }).click();
    await page.getByRole("button", { name: "Delete" }).click();
    await expect(page.locator(".nu-queue-row", { hasText: name })).toHaveCount(0);
  }
}

/** Unique per run, so a leftover from a failed run cannot be mistaken for this one. */
const PREFIX = "Playwright report";
const stamp = () => `${PREFIX} ${Date.now()}`;

test("a report built in the browser survives a reload and answers", async ({ page }) => {
  const name = stamp();
  await signIn(page, "admin", "/reports/builder?resource=order&period=all_time");

  await expect(page.getByTestId("report-question")).toBeVisible();
  await choose(page, "Group by", "Channel");
  // The chart kind is a segmented control: its radio input is visually
  // hidden, so the label is what a person actually clicks.
  await page.locator('label:has([title="pie"])').click();
  await page.getByLabel("Name").fill(name);
  await page.getByTestId("save-report").click();

  // Lands on the saved report, with its answer already computed.
  await expect(page).toHaveURL(/\/reports\?report=/);
  await expect(page.getByTestId("report-matched")).toContainText(/rows measured/);

  await page.reload();
  await expect(page.locator(".nu-queue-row", { hasText: name }).first()).toBeVisible();
  const measured = await page.getByTestId("report-matched").textContent();
  const rows = Number((measured ?? "").replace(/[^\d]/g, ""));
  // Every order, not the page the builder previewed — compared against what
  // the ledger says it holds, so this holds at either seed scale.
  await page.goto("/orders");
  const everyOrder = Number(
    (((await page.getByTestId("entity-total").textContent()) ?? "").split("of")[1] ?? "").replace(
      /[^\d]/g,
      "",
    ),
  );
  expect(rows).toBe(everyOrder);

  await deleteReports(page, PREFIX);
});

test("a private report is invisible to somebody else", async ({ page, browser }) => {
  const name = stamp();
  await signIn(page, "admin", "/reports/builder?resource=ticket&period=all_time&group=severity");
  await page.getByLabel("Name").fill(name);
  await page.getByTestId("save-report").click();
  await expect(page).toHaveURL(/\/reports\?report=/);

  const other = await browser.newContext({ storageState: storageStateFor("manager") });
  const otherPage = await other.newPage();
  await signIn(otherPage, "manager", "/reports");
  // Nothing is shared by accident: a report is private until its owner says
  // otherwise, and a member's list simply does not contain it (§5).
  await expect(otherPage.locator(".nu-queue-row", { hasText: name })).toHaveCount(0);
  await other.close();

  await deleteReports(page, PREFIX);
});
