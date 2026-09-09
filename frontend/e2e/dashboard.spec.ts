/** Exercise real ECharts canvases and their readable/downloadable data alternatives. */
import { expect, test } from "@playwright/test";

import { CHART_KEYS } from "../src/api/dashboard";
import { apiAs, endpoint } from "./api";
import { signIn } from "./auth";

test("the expanded dashboard renders, exports every scatter dimension, and keeps the period", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard?period=current_year");
  // Counted off the declaration rather than typed: the number was 16 and the
  // seventeenth panel shipped without it, so the failure read as a broken
  // dashboard rather than as a stale test.
  await expect(page.locator(".nu-chartcard")).toHaveCount(CHART_KEYS.length);
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


test("a record written elsewhere changes the number on the front page", async ({ page }) => {
  /**
   * The whole argument for invalidating the aggregate cache on writes rather
   * than on a timer.
   *
   * The overview is twenty-odd `GROUP BY`s over the whole dataset for a screen
   * people open first thing and leave open, so it is cached — but behind a
   * five-minute TTL it would tell somebody who has just closed a ticket that
   * it is still open, and they are the one person guaranteed to notice. Here
   * the write happens *outside the browser*, so nothing on the page could be
   * patching its own copy: the number can only change because the server
   * recomputed.
   *
   * It also proves the other half, which no component test can: that a
   * soft-deleted record leaves every number. `open_tickets` counted them for
   * as long as it existed — 189 open tickets against a table showing 50.
   */
  const open = async (): Promise<number> => {
    await page.goto("/dashboard?period=current_year");
    const tile = page.locator(".nu-statcard").filter({ hasText: "Open tickets" });
    await expect(tile).toBeVisible();
    const shown = (await tile.locator(".nu-statcard-number").textContent()) ?? "";
    return Number(shown.replace(/[^\d]/g, ""));
  };

  await signIn(page, "admin", "/dashboard?period=current_year");
  const before = await open();
  expect(before).toBeGreaterThan(0);

  const api = await apiAs("admin");
  let created = "";
  try {
    const response = await api.post(endpoint("/records/ticket"), {
      data: {
        subject: `Dashboard cache probe ${Date.now()}`,
        description: "Written outside the browser.",
        status: "OPEN", priority: "NORMAL", severity: "MINOR",
        category: "SUPPORT", channel: "EMAIL",
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    created = ((await response.json()) as { id: string }).id;

    expect(await open()).toBe(before + 1);
  } finally {
    if (created) {
      expect((await api.delete(endpoint(`/records/ticket/${created}`))).status()).toBe(200);
    }
    await api.dispose();
  }

  // And gone again after the delete, because a soft delete means gone from
  // every list — the front page included.
  expect(await open()).toBe(before);
});
