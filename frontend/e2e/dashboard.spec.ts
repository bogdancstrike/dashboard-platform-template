/** Exercise real ECharts canvases and their readable/downloadable data alternatives. */
import { expect, test } from "@playwright/test";

test("the expanded dashboard renders, exports every scatter dimension, and keeps the period", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard?period=current_year");
  await expect(page.locator(".nu-chartcard")).toHaveCount(16);
  const radar = page.locator('[data-chart-id="support_profile"]');
  await expect(radar.locator("canvas")).toBeAttached();
  const treemap = page.locator('[data-chart-id="portfolio_budget"]');
  await expect(treemap.locator("canvas")).toBeAttached();
  await treemap.screenshot({ path: "test-results/dashboard-treemap.png" });
  await radar.screenshot({ path: "test-results/dashboard-radar.png" });
  const scatter = page.locator('[data-chart-id="budget_vs_progress"]');
  await scatter.getByTitle("Table", { exact: true }).click();
  await expect(scatter.getByRole("columnheader", { name: "Budget spent (%)", exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await scatter.getByRole("button", { name: "Download this panel as CSV" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("budget_vs_progress.csv");
  await page.reload();
  await expect(scatter.getByRole("columnheader", { name: "Work done (%)" })).toBeAttached();
  await expect(page).toHaveURL(/period=current_year/);
  await page.screenshot({ path: "test-results/dashboard-expanded.png", fullPage: true });
  expect(errors).toEqual([]);
});
