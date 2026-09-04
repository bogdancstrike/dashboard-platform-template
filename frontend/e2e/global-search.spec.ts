import { expect, test } from "@playwright/test";

import { signIn } from "./auth";

/**
 * Global search (§32) against the real stack.
 *
 * The behaviour worth protecting is the ranking and the evidence for it: an
 * exact reference has to come first, and every hit has to say which field
 * matched. A cross-entity list that cannot explain its own order is a list
 * nobody scrolls past the first row of.
 */
test.describe("global search", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/find/global"));

  test("asks for a term before it searches anything", async ({ page }) => {
    await expect(
      page.getByText("Search for a reference, a name, an address"),
    ).toBeVisible();

    await page.getByPlaceholder("Search everything…").fill("a");
    await expect(page.getByText("Type at least 2 characters to search.")).toBeVisible();
  });

  test("puts the record named by the term first, and says why", async ({ page }) => {
    await page.getByPlaceholder("Search everything…").fill("TSK-00042");

    const hits = page.getByTestId("global-hit");
    await expect(hits.first()).toContainText("TSK-00042");
    // The evidence: which field matched, with the term marked inside it.
    await expect(hits.first().locator("mark.nu-mark").first()).toHaveText("TSK-00042");
  });

  test("groups results by dataset and hands one to Data Explorer", async ({ page }) => {
    await page.getByPlaceholder("Search everything…").fill("migration");
    await expect(page.getByTestId("global-total")).toBeVisible();

    await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
    await page.getByRole("button", { name: /Data Explorer/ }).first().click();

    // Same term, now narrowed to that one dataset.
    await expect(page).toHaveURL(/\/explore\?resource=project&q=migration/);
    await expect(page.getByPlaceholder("Search projects…")).toHaveValue("migration");
  });

  test("the keyboard walks the results and opens one", async ({ page }) => {
    const box = page.getByPlaceholder("Search everything…");
    await box.fill("migration");
    await expect(page.getByTestId("global-hit").first()).toBeVisible();

    await box.press("ArrowDown");
    await box.press("ArrowDown");
    const active = page.locator(".nu-global-hit.is-active");
    await expect(active).toHaveCount(1);
    const chosen = (await active.innerText()).split("\n")[0] ?? "";

    await box.press("Enter");

    // Opened as itself, in the explorer, filtered to that one record.
    await expect(page).toHaveURL(/\/explore\?resource=\w+&f\.id=/);
    await expect(page.getByRole("cell", { name: chosen, exact: true })).toBeVisible();
  });

  test("says plainly when nothing matches", async ({ page }) => {
    await page.getByPlaceholder("Search everything…").fill("zzzzz-no-such-thing");
    await expect(page.getByText(/Nothing matches/)).toBeVisible();
  });
});
