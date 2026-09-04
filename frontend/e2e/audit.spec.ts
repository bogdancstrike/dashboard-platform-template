import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The audit explorer (§21) against the real stack and the seeded ledger.
 *
 * What this level is for here is the two properties a component test cannot
 * reach: that the filtering really happens in PostgreSQL over the whole ledger
 * rather than over a downloaded page, and that the permission boundary is the
 * server's rather than the menu's. An audit screen that answers "nobody
 * deleted anything" from twenty-five of four thousand rows is worse than no
 * audit screen, because it is believed.
 */

function ledger(page: Page) {
  return page.getByRole("table").last();
}

async function totalShown(page: Page): Promise<number> {
  const text = (await page.getByTestId("audit-total").textContent()) ?? "0";
  return Number(text.replace(/[^\d]/g, ""));
}

test.describe("audit explorer", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/admin/audit"));

  test("shows who did what, when and to which record", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Audit log" })).toBeVisible();
    await expect(ledger(page).getByRole("row").nth(1)).toBeVisible();

    for (const heading of ["When", "Actor", "Action", "Resource", "Result"]) {
      await expect(page.getByRole("columnheader", { name: heading })).toBeVisible();
    }
    expect(await totalShown(page)).toBeGreaterThan(100);
  });

  test("filtering narrows the whole ledger, not the page on screen", async ({ page }) => {
    const before = await totalShown(page);

    await page.getByRole("combobox", { name: "Action" }).click();
    await page.getByTitle("Delete", { exact: true }).click();
    await page.keyboard.press("Escape");

    await expect(page).toHaveURL(/action=DELETE/);
    // The count moved, which only happens if the server re-counted.
    await expect
      .poll(async () => totalShown(page))
      .toBeLessThan(before);
    expect(await totalShown(page)).toBeGreaterThan(0);
  });

  test("an entry opens its before → after diff, and the URL carries it", async ({ page }) => {
    // Only rows that actually changed something have a diff worth opening.
    await page.getByRole("combobox", { name: "Action" }).click();
    await page.getByTitle("Update", { exact: true }).click();
    await page.keyboard.press("Escape");

    await ledger(page).getByRole("row").nth(1).click();

    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/entry=/);
    await expect(page.getByRole("table", { name: "Field changes" })).toBeVisible();

    // The drawer survives a paste of the URL, which is what makes an
    // investigation shareable (§69).
    const url = page.url();
    await page.goto("/dashboard");
    await page.goto(url);
    await expect(page.getByRole("table", { name: "Field changes" })).toBeVisible();
  });

  test("an impersonated action names both identities", async ({ page }) => {
    await page.getByRole("combobox", { name: "Impersonation" }).click();
    await page.getByTitle("While impersonating").click();

    await expect(page).toHaveURL(/impersonated=true/);
    // Every row on screen was taken by somebody acting as somebody else, and
    // says who.
    const badge = page.getByTestId("impersonated").first();
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("via");
  });

  test("a correlation id from an error leads to the action behind it", async ({ page }) => {
    const first = ledger(page).getByRole("row").nth(1);
    await first.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Whatever the drawer shows for this row, the ledger can be searched by it.
    const correlation = await dialog.getByText(/^[0-9a-f]{16,}$/).first().textContent();
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByLabel("Search the audit log").fill(correlation ?? "");
    await expect.poll(async () => totalShown(page)).toBeGreaterThan(0);
    await expect.poll(async () => totalShown(page)).toBeLessThan(10);
  });

  test("the empty state explains itself rather than showing a blank table", async ({ page }) => {
    // A filter combination the seeded ledger cannot satisfy.
    await page.goto("/admin/audit?action=DELETE&result=PARTIAL&q=zzz-no-such-actor");

    await expect(page.getByText("No records match these filters")).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear filters" })).toBeVisible();
  });
});

test.describe("audit permissions", () => {
  test.use({ storageState: storageStateFor("operator") });

  test("a role without audit.view is told which permission it lacks", async ({ page }) => {
    await signIn(page, "operator", "/dashboard");

    // The menu hides what the role cannot reach, rather than offering a dead
    // end…
    await expect(page.getByRole("menuitem", { name: "Audit log" })).toHaveCount(0);

    // …the deep link says which permission is missing, in words…
    const [request] = await Promise.all([
      page.waitForRequest(
        (candidate) =>
          candidate.url().includes("/platform/") &&
          Boolean(candidate.headers()["authorization"]),
      ),
      page.goto("/admin/audit"),
    ]);
    await expect(page.getByText("Permission required")).toBeVisible();
    await expect(page.getByText("Your role does not include audit.view.")).toBeVisible();

    // …and the API refuses independently, so the guard is a courtesy rather
    // than the control.
    const refused = await page.request.get("/platform/admin/audit", {
      headers: { Authorization: request.headers()["authorization"]! },
    });
    expect(refused.status()).toBe(403);
    expect((await refused.json()).details.missing).toEqual(["audit.view"]);
  });
});

test.describe("audit ledger integrity", () => {
  test("the ledger has no writer", async ({ page }) => {
    await signIn(page, "admin", "/admin/audit");

    const [request] = await Promise.all([
      page.waitForRequest(
        (candidate) =>
          candidate.url().includes("/platform/") &&
          Boolean(candidate.headers()["authorization"]),
      ),
      page.reload(),
    ]);
    const token = request.headers()["authorization"]!;

    const listed = await page.request.get("/platform/admin/audit?page_size=1", {
      headers: { Authorization: token },
    });
    const one = (await listed.json()) as { items: { id: string }[] };
    const id = one.items[0]!.id;

    // An audit trail with a DELETE is a trail whose missing entry proves
    // nothing. None of these is mounted.
    for (const response of [
      await page.request.post("/platform/admin/audit", {
        headers: { Authorization: token },
        data: {},
      }),
      await page.request.delete(`/platform/admin/audit/${id}`, {
        headers: { Authorization: token },
      }),
    ]) {
      expect(response.status()).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    }

    // And the row is still there.
    const after = await page.request.get(`/platform/admin/audit/${id}`, {
      headers: { Authorization: token },
    });
    expect(after.status()).toBe(200);
  });
});
