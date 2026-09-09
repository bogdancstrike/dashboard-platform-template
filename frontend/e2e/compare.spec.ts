import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * Two or more records side by side, against the real stack (§47).
 *
 * The claims only a browser can make:
 *
 * **The whole journey works.** A comparison is reached from a *selection*, so
 * this ticks two rows on a list, presses Compare, and reads the result — the
 * three steps a reader takes and the two hand-offs between them.
 *
 * **The values are the records'.** Each column links to the record it came
 * from, and following the link lands on that record — which is what makes the
 * table checkable rather than merely plausible.
 *
 * **The differences are marked and the agreements are reachable.** Both, on
 * the seeded data rather than on a fixture that was built to show them.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

/** The tick box on one data row of the orders ledger. */
function rowBox(page: Page, index = 0) {
  return page.locator("tr.ant-table-row").nth(index).locator(".ant-checkbox-input");
}

async function compareTwoOrders(page: Page) {
  await signIn(page, "admin", "/orders");
  await expect(page.locator("tr.ant-table-row").first()).toBeVisible();
  await rowBox(page, 0).check();
  await rowBox(page, 1).check();

  const compare = page.getByTestId("bulk-compare");
  await expect(compare).toBeVisible();
  await compare.click();
  await expect(page).toHaveURL(/\/compare\?type=order&ids=/);
  await expect(page.getByTestId("compare-table")).toBeVisible();
}

test("two rows ticked on a list become a comparison", async ({ page }) => {
  await compareTwoOrders(page);

  // Two columns of values plus the field column.
  const headers = page.getByTestId("compare-table").locator("thead th");
  await expect(headers).toHaveCount(3);
  // And the header of each is the record, linked.
  await expect(page.getByTestId("compare-table").locator("thead a")).toHaveCount(2);
});

test("a column's header opens the record it came from", async ({ page }) => {
  await compareTwoOrders(page);
  const first = page.getByTestId("compare-table").locator("thead a").first();
  const name = ((await first.textContent()) ?? "").trim();

  await first.click();
  await expect(page).toHaveURL(/\/orders\/[0-9a-f-]{36}/);
  // The record page names the same order, which is what makes the column
  // checkable rather than merely plausible.
  await expect(page.locator("#nu-main")).toContainText(name.replace(/[A-Z ]+$/, "").trim());
});

test("the differences are marked, and the agreements are one click away", async ({
  page,
}) => {
  await compareTwoOrders(page);

  // Two orders from the seeded ledger differ on something — if they ever stop
  // doing so this fails rather than passing on an empty table.
  const table = page.getByTestId("compare-table");
  await expect(table.getByText("differs").first()).toBeVisible();
  const differing = await table.locator("tbody tr").count();
  expect(differing).toBeGreaterThan(0);

  await page.locator(".ant-segmented-item-label").filter({ hasText: "Every field" }).click();
  // Strictly more rows, because the fields that agree are the evidence that
  // two records are the same thing.
  await expect
    .poll(async () => table.locator("tbody tr").count())
    .toBeGreaterThan(differing);
});

test("an address naming one record asks for a selection", async ({ page }) => {
  await signIn(page, "admin", "/compare?type=order&ids=11111111-1111-1111-1111-111111111111");
  // One record compared with nothing is its own page, and the page says where
  // to make the choice rather than showing an error.
  await expect(page.getByText("Choose at least two records")).toBeVisible();
});

test("more records than can be read side by side is refused, with the numbers", async ({
  page,
}) => {
  const ids = Array.from({ length: 7 }, (_unused, index) =>
    `${String(index + 1).repeat(8)}-1111-1111-1111-111111111111`,
  ).join(",");
  await signIn(page, "admin", `/compare?type=order&ids=${ids}`);

  await expect(page.getByTestId("compare-refused")).toBeVisible();
  await expect(page.getByTestId("compare-refused")).toContainText("Compare fewer");
});

test("the comparison is legible and keyboard-reachable", async ({ page }) => {
  await compareTwoOrders(page);
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

  const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
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
