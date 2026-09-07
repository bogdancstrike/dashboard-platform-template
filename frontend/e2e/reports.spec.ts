import { expect, test, type Page } from "@playwright/test";

import { sweepReports } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Saved reports against the real stack (§28, §5).
 *
 * Two things a component test cannot show: a report built in the browser is
 * still there — and still answers — after a reload, and a private one is
 * invisible to somebody else's session.
 *
 * Serial, and swept unconditionally: reports are rows in a shared database,
 * and a suite that leaves five "Playwright report" entries behind makes the
 * next run's list assertions meaningless.
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

/** Unique per run, so a leftover from a failed run cannot be mistaken for this one. */
const PREFIX = "Playwright report";
const stamp = () => `${PREFIX} ${Date.now()}`;

/**
 * Remove every report this suite created, however the test ended.
 *
 * Unconditional, and through the API rather than the page: cleanup that only
 * runs on the happy path is cleanup that stops running the moment a test
 * fails, and the rows then accumulate. Twenty of them did — enough that the
 * page's own list assertions were measuring somebody else's leftovers.
 */
test.afterEach(() => sweepReports([PREFIX]));

test("a report built in the browser survives a reload and answers", async ({ page }) => {
  const name = stamp();
  await signIn(page, "admin", "/reports/builder?resource=order&period=all_time");

  await expect(page.getByTestId("report-question")).toBeVisible();
  await choose(page, "Group by", "Channel");
  // The kind strip lives in the chart's own header now, as icons: its radio
  // input is visually hidden, so the label is what a person actually clicks,
  // and the kind key is kept as the icon's `title`.
  await page.locator('label:has([title="pie"])').click();
  await page.getByTestId("open-save-report").click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(name);
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
});

test("a private report is invisible to somebody else", async ({ page, browser }) => {
  const name = stamp();
  await signIn(page, "admin", "/reports/builder?resource=ticket&period=all_time&group=severity");
  await page.getByTestId("open-save-report").click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByTestId("save-report").click();
  await expect(page).toHaveURL(/\/reports\?report=/);

  const other = await browser.newContext({ storageState: storageStateFor("manager") });
  const otherPage = await other.newPage();
  await signIn(otherPage, "manager", "/reports");
  // Nothing is shared by accident: a report is private until its owner says
  // otherwise, and a member's list simply does not contain it (§5).
  await expect(otherPage.locator(".nu-queue-row", { hasText: name })).toHaveCount(0);
  await other.close();
});
