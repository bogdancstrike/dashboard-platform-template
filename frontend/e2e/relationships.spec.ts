import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./auth";

/**
 * The relationship explorer (§44, §50) against the real stack.
 *
 * What is worth protecting is the trail. Following four links to an
 * interesting order and finding no way back to the customer it started from is
 * the failure this page exists to avoid, so the tests walk forward and back
 * and assert the path is in the URL the whole time.
 */
async function startFrom(page: Page, reference: string): Promise<void> {
  await page.getByPlaceholder("Search a record to start from…").fill(reference);
  await expect(page.getByRole("button", { name: "Start here" }).first()).toBeVisible();
  await page.getByRole("button", { name: "Start here" }).first().click();
  await expect(page.getByRole("heading", { name: reference })).toBeVisible();
}

test.describe("relationship explorer", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/find/relationships"));

  test("starts from any record found by name", async ({ page }) => {
    await startFrom(page, "CUS-00001");

    // Both directions, read from this record's side.
    await expect(page.getByText("Account manager")).toBeVisible();
    await expect(page.getByText(/· as customer/).first()).toBeVisible();
  });

  test("following a connection keeps the way back", async ({ page }) => {
    const first = "CUS-00001";
    await startFrom(page, first);

    await page.getByRole("button", { name: "Follow" }).first().click();

    // Somewhere else now, with a breadcrumb back to where it began.
    await expect(page.getByRole("heading", { name: first })).toBeHidden();
    const trail = page.getByRole("button", { name: first, exact: true });
    await expect(trail).toBeVisible();
    expect(new URL(page.url()).searchParams.get("trail")).toContain(first);

    await trail.click();
    await expect(page.getByRole("heading", { name: first })).toBeVisible();
    // Stepping back discards what came after it.
    expect(new URL(page.url()).searchParams.get("trail")).toBe("[]");
  });

  test("the graph shows the same connections as the list", async ({ page }) => {
    await startFrom(page, "CUS-00001");
    const connections = Number(
      (await page.getByText(/\d+ connections/).innerText()).replace(/\D/g, ""),
    );

    await page.getByTestId("relationship-view").getByText("Graph", { exact: true }).click();

    const graph = page.getByRole("img", { name: /nearest connections/ });
    await expect(graph).toBeVisible();
    // The root plus one node per connection.
    await expect(graph.locator(".nu-graph-node")).toHaveCount(connections + 1);
  });

  test("hands the record to Data Explorer", async ({ page }) => {
    await startFrom(page, "CUS-00001");

    await page.getByRole("button", { name: /Open in Data Explorer/ }).click();

    await expect(page).toHaveURL(/\/explore\?resource=customer&f\.id=/);
    await expect(page.getByRole("cell", { name: "CUS-00001", exact: true })).toBeVisible();
  });
});
