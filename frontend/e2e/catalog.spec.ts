import { expect, test } from "@playwright/test";

import { signIn } from "./auth";

/**
 * The data catalogue (§65) against the real stack.
 *
 * What is worth protecting is that the numbers are real: the catalogue is
 * generated from the same declarations the explorer reads and profiled against
 * the same rows, so a field listed here is one that can actually be filtered,
 * and a completeness figure is a count and not a guess.
 */
test.describe("data catalogue", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/find/catalog"));

  test("lists every dataset with its size and field count", async ({ page }) => {
    // Scoped to the catalogue: the navigation has a "Tasks" of its own.
    const catalog = page.getByTestId("catalog");

    await expect(page.getByRole("heading", { name: "Data catalogue" })).toBeVisible();
    await expect(catalog.getByText("Tasks", { exact: true })).toBeVisible();
    await expect(catalog.getByText("Devices", { exact: true })).toBeVisible();
    await expect(catalog.getByText(/\d+ fields/).first()).toBeVisible();
  });

  test("shows what a field accepts and how completely it is filled in", async ({ page }) => {
    const tasks = page.getByRole("row").filter({ hasText: "Reference" }).first();

    await expect(tasks).toContainText("text");
    // A required column is complete, and says so as a percentage.
    await expect(tasks).toContainText("100%");
    await expect(tasks).toContainText("search");
  });

  test("finds which dataset carries a field", async ({ page }) => {
    const catalog = page.getByTestId("catalog");
    await page.getByLabel("Filter the catalogue").fill("battery");

    await expect(catalog.getByText("Devices", { exact: true })).toBeVisible();
    await expect(catalog.getByText("Tasks", { exact: true })).toBeHidden();
  });

  test("hands a dataset to Data Explorer", async ({ page }) => {
    await page.getByTestId("explore-task").click();

    await expect(page).toHaveURL(/\/explore\?resource=task/);
    await expect(page.getByRole("columnheader", { name: "Reference" })).toBeVisible();
  });
});
