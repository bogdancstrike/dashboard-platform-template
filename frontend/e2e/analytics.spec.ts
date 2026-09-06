import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./auth";

/**
 * Choose a value in one of the context selects.
 *
 * Clicks the selector rather than the search input inside it: with a value
 * already chosen, the rendered label sits on top of the input and swallows
 * the click.
 */
async function readAsTable(page: Page, panel: string) {
  // The label, not the `title` span inside it: AntD's Segmented puts the
  // radio in the label, and clicking the inner span does not select it.
  const card = page.getByTestId(panel);
  await card.locator('label:has([title="Table"])').click();
  // `.ant-table-row` rather than `tbody tr`: AntD renders a zero-height
  // measurement row first, and reading that one finds the headings.
  return card.locator(".ant-table-row");
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name: label }) })
    .locator(".ant-select-selector")
    .click();
  await page.getByTitle(option, { exact: true }).click();
}

/**
 * The analytics workspace against the real stack (§2, §44, §71).
 *
 * The assertion a component test cannot make: the numbers on the page are the
 * database's, over the whole dataset, and they move when the question does.
 * A mocked panel proves the layout; this proves the aggregate.
 */
test.describe("analytics", () => {
  test("measures the whole dataset and moves with the period", async ({ page }) => {
    await signIn(page, "admin", "/analytics?resource=order&period=all_time");

    const matched = page.getByTestId("analysis-matched");
    await expect(matched).toContainText(/\d/);
    const everything = Number(((await matched.textContent()) ?? "").replace(/[^\d]/g, ""));
    // The seed holds hundreds of orders; a page measuring the twenty-five it
    // downloaded would say twenty-five.
    expect(everything).toBeGreaterThan(100);

    await choose(page, "Period", "Last 30 days");

    await expect
      .poll(async () => Number(((await matched.textContent()) ?? "").replace(/[^\d]/g, "")))
      .toBeLessThan(everything);
    await expect(page).toHaveURL(/period=last_30_days/);
  });

  test("a chart is a way into the records behind it", async ({ page }) => {
    await signIn(page, "admin", "/analytics?resource=order&period=all_time&group=status");

    const rows = await readAsTable(page, "analytics-breakdown");
    const first = rows.first();
    const value = ((await first.locator("td").first().textContent()) ?? "").trim();
    await first.click();

    // §44: the drill-down lands on the entity's own page, filtered.
    await expect(page).toHaveURL(new RegExp(`/orders\\?f\\.status=${value}`));
    await expect(page.getByTestId("entity-total")).toBeVisible();
  });

  test("says how much of the answer is on the screen", async ({ page }) => {
    await signIn(page, "admin", "/analytics?resource=ticket&period=all_time&group=severity");

    const rows = await readAsTable(page, "analytics-breakdown");
    const drawn = await rows.count();

    // The tile counts what the chart drew. A breakdown that quietly showed
    // twelve of forty values would disagree with it — which is the failure
    // this number exists to make visible.
    const tile = page.getByTestId("analysis-headline").getByText("Values in view");
    await expect(tile.locator("..")).toContainText(String(drawn));
  });
});
