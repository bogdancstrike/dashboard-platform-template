import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * People and impersonation (§12) against the real stack.
 *
 * Two claims here can only be checked end to end. The first is that the
 * directory filters in SQL across a join — role lives on another table, so a
 * page that narrowed the loaded rows would look identical until page two. The
 * second is impersonation: `X-Impersonate-User` has to change what the *API*
 * returns, not what the browser draws, and the audit row has to name both
 * people. A component test with a mocked transport cannot tell the difference.
 */

/** The signed-in person's own name is in the header too, so scope to the page. */
function main(page: Page) {
  return page.locator("#nu-main");
}

/**
 * Find one person among the hundred and fifty the seed provisions.
 *
 * Paging to them would be a test of the pager; searching is what a person
 * does, and it exercises the server-side `q` the directory actually ships.
 */
async function find(page: Page, name: string) {
  await page.getByLabel("Search people").fill(name);
  const row = main(page).getByText(name, { exact: true });
  await expect(row).toBeVisible();
  return row;
}

test.describe("the people directory", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/admin/users"));

  test("lists the seeded people with role, group, status and last sign-in", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expect(main(page).getByText("Ada Administrator")).toBeVisible();
    await expect(main(page).getByText("admin@nucleus.example")).toBeVisible();

    // The count is the server's, so it describes the table and not the page.
    await expect(page.getByTestId("user-total")).toContainText("people");
  });

  test("filters by role in SQL rather than narrowing the loaded page", async ({ page }) => {
    await expect(page.getByTestId("user-total")).toBeVisible();
    const total = await page.getByTestId("user-total").innerText();

    await page.getByRole("combobox", { name: "Role" }).click();
    await page.getByTitle(/^ADMINISTRATOR · /).click();

    await expect(page.getByTestId("user-total")).not.toHaveText(total);
    await expect(page).toHaveURL(/role_code=ADMINISTRATOR/);
    await expect(main(page).getByText("Ada Administrator")).toBeVisible();

    // The count is the server's answer to the *filtered* question: fewer than
    // everybody, and matching a table in which every row carries the role that
    // was asked for. A page that narrowed what it had already downloaded would
    // still show the same total as before.
    const narrowed = Number(
      ((await page.getByTestId("user-total").innerText()) ?? "").replace(/[^\d]/g, ""),
    );
    expect(narrowed).toBeGreaterThan(0);
    expect(narrowed).toBeLessThan(Number(total.replace(/[^\d]/g, "")));
    const roles = await main(page).getByRole("row").locator(".ant-tag").allTextContents();
    expect(roles.filter((role) => role === "Administrator")).toHaveLength(narrowed);

    // And the filter survives the reload, because it lives in the URL (§69):
    // the same narrowed answer, from a page that was told nothing but its own
    // address.
    await page.reload();
    await expect(main(page).getByText("Ada Administrator")).toBeVisible();
    await expect(page.getByTestId("user-total")).toHaveText(`${narrowed} people`);
  });

  test("opens a person and explains their access by role and by group", async ({ page }) => {
    await (await find(page, "Uma User")).click();

    await expect(page.getByRole("heading", { name: "Uma User" })).toBeVisible();
    const permissions = page.getByTestId("effective-permissions");
    await expect(permissions).toBeVisible();
    // The union the API actually enforces — not the role's half of it.
    await expect(permissions.getByText("records.view")).toBeVisible();
  });
});

test.describe("impersonation", () => {
  // Serial: one of these starts an impersonation and the other reads the row
  // it wrote. Interleaved, the second would race the first.
  test.describe.configure({ mode: "serial" });

  test("carries both identities, changes what the API returns, and ends", async ({ page }) => {
    await signIn(page, "admin", "/admin/users");
    await (await find(page, "Uma User")).click();

    await page.getByTestId("impersonate").click();
    await page.getByRole("button", { name: "Start" }).click();

    // The banner is unmissable on purpose: a forgotten impersonation is the
    // failure mode this feature has.
    const banner = page.getByRole("status").filter({ hasText: "viewing the platform as" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("Uma User");

    // The API now answers as the viewer, so an administrator-only screen is
    // refused — proof the header reached the server rather than the browser.
    await page.goto("/admin/roles");
    await expect(page.getByText("Your role does not include roles.manage.")).toBeVisible();

    await banner.getByRole("button", { name: /Return to your own account/ }).click();
    await expect(banner).toBeHidden();
    await page.goto("/admin/roles");
    await expect(page.getByRole("heading", { name: "Roles & permissions" })).toBeVisible();
  });

  test("records the impersonation in the audit log under the real actor", async ({ page }) => {
    await signIn(page, "admin", "/admin/audit?action=IMPERSONATE");

    const rows = page.getByRole("table").last().getByRole("row");
    await expect(rows.nth(1)).toBeVisible();
    // The row belongs to the administrator who started it, not to the person
    // who was acted as — otherwise the ledger would launder the act.
    await expect(rows.nth(1)).toContainText("Ada Administrator");
  });
});

test.describe("directory permissions", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("a viewer reads the directory but is offered no way to change it", async ({ page }) => {
    await signIn(page, "viewer", "/admin/users");
    await (await find(page, "Uma User")).click();

    await expect(page.getByRole("heading", { name: "Uma User" })).toBeVisible();
    // `users.view` without `users.manage`: readable, not editable. The
    // impersonate button is shown and refused rather than hidden, because a
    // control that vanishes teaches nobody why they cannot use it (§76).
    await expect(page.getByRole("combobox", { name: "Account status" })).toHaveCount(0);
    await expect(page.getByTestId("impersonate")).toBeDisabled();
  });

  test("a viewer cannot impersonate by calling the endpoint directly", async ({ page }) => {
    await signIn(page, "viewer", "/dashboard");

    const status = await page.evaluate(async () => {
      const response = await fetch(
        "/platform/admin/users/00000000-0000-0000-0000-000000000000/impersonate",
        { method: "POST", headers: { "Content-Type": "application/json" } },
      );
      return response.status;
    });

    // 401 without a token, 403 with one — either way, refused by the server.
    expect([401, 403]).toContain(status);
  });
});
