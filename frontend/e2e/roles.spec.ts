import { expect, test, type Page } from "@playwright/test";

import { sweepRoles } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * The permission matrix (§13) against the real stack.
 *
 * The claim this page makes is the one only an end-to-end test can check:
 * granting a permission changes what its holders may do **on their next
 * request**, with no re-login. That is true because `_permissions_for` reads
 * the `roles` table on every request rather than trusting the token — and
 * nothing short of two real sessions against one database can demonstrate it.
 *
 * These tests edit live authorization, so each one puts back what it changed.
 */
function cell(page: Page, role: string, permission: string) {
  return page.getByRole("checkbox", { name: `${role}: ${permission}` });
}

async function applyChanges(page: Page): Promise<void> {
  await page.getByTestId("save-roles").click();
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(/role.? updated/)).toBeVisible();
}

test.describe("the permission matrix", () => {
  // Serial: these edit the live authorization model. Two of them interleaving
  // would have one putting back what the other had just granted.
  test.describe.configure({ mode: "serial" });
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/admin/roles"));

  test("shows every permission the code checks for, against every role", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Roles & permissions" })).toBeVisible();

    // The catalogue is the code's own, so a permission an endpoint requires
    // is a permission this screen can grant.
    await expect(page.getByText("View audit logs").first()).toBeVisible();
    await expect(page.getByText("Manage roles").first()).toBeVisible();
    await expect(page.getByText("Administrator").first()).toBeVisible();
    await expect(page.getByText("Viewer").first()).toBeVisible();
    await expect(page.getByText("yours").first()).toBeVisible();
  });

  test("refuses to let an administrator lock themselves out", async ({ page }) => {
    // Disabled in the UI, and refused by the server if anybody gets past it.
    await expect(cell(page, "Administrator", "Manage roles")).toBeDisabled();
    await expect(cell(page, "Administrator", "View records")).toBeEnabled();
  });

  test("a granted permission applies on the holder's next request", async ({ page, browser }) => {
    // The viewer cannot reach the audit ledger.
    const viewerContext = await browser.newContext({ storageState: storageStateFor("viewer") });
    const viewerPage = await viewerContext.newPage();
    await signIn(viewerPage, "viewer", "/admin/audit");
    await expect(viewerPage.getByText("Permission required")).toBeVisible();

    // Grant it, from the matrix, as an administrator.
    await cell(page, "Viewer", "View audit logs").check();
    await applyChanges(page);

    try {
      // The same signed-in session — no re-login, no new token — may now read
      // it. The permission came from the table, not from the JWT.
      await viewerPage.reload();
      await expect(viewerPage.getByRole("heading", { name: "Audit log" })).toBeVisible();
      await expect(viewerPage.getByText("Permission required")).toBeHidden();
    } finally {
      // Put authorization back however this ends.
      await page.reload();
      await cell(page, "Viewer", "View audit logs").uncheck();
      await applyChanges(page);
      await viewerContext.close();
    }
  });

  test("a change is staged and confirmed rather than fired per click (§73)", async ({ page }) => {
    await cell(page, "Viewer", "View audit logs").check();
    await expect(page.getByTestId("save-roles")).toHaveText(/Save 1 change/);

    // Discarding leaves the model untouched — a reload proves it.
    await page.getByRole("button", { name: /Discard/ }).click();
    await page.reload();
    await expect(cell(page, "Viewer", "View audit logs")).not.toBeChecked();
  });

  test("an edit appears in the audit log with the permissions it moved", async ({ page }) => {
    await cell(page, "Viewer", "View background jobs").check();
    await applyChanges(page);

    try {
      await page.goto("/admin/audit?action=PERMISSION_CHANGE&resource_type=role");
      const first = page.getByRole("table").last().getByRole("row").nth(1);
      await expect(first).toBeVisible();
      await first.click();

      const diff = page.getByRole("table", { name: "Field changes" });
      await expect(diff).toBeVisible();
      // Scoped to the diff: "Roles & permissions" is also in the navigation.
      await expect(diff.getByText("permissions", { exact: true })).toBeVisible();
    } finally {
      await page.goto("/admin/roles");
      await cell(page, "Viewer", "View background jobs").uncheck();
      await applyChanges(page);
    }
  });
});

test.describe("matrix permissions", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("a role that manages people still cannot rewrite the model", async ({ page }) => {
    await signIn(page, "manager", "/dashboard");

    // The menu does not offer it…
    await expect(page.getByRole("menuitem", { name: "Roles & permissions" })).toHaveCount(0);

    // …and the deep link says which permission is missing.
    await page.goto("/admin/roles");
    await expect(page.getByText("Your role does not include roles.manage.")).toBeVisible();
  });
});

test.describe("roles an installation adds", () => {
  // Serial: these two share the `roles` table, and in parallel the one that
  // asserts "nothing was added here" ran while the other's role existed.
  test.describe.configure({ mode: "serial" });

  /** Roles this file made, removed however the test ended. */
  const made: string[] = [];

  test.afterEach(async () => {
    await sweepRoles(made.splice(0, made.length));
  });

  test("a custom role is created, is in force at once, and can be removed", async ({
    page,
  }) => {
    await signIn(page, "admin", "/admin/roles");
    await expect(page.getByTestId("new-role")).toBeVisible();

    const name = `E2E auditor ${Date.now()}`;
    const code = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    await page.getByTestId("new-role").click();
    await page.getByLabel("Role name").fill(name);
    // The code follows the name, because it is the identifier the audit trail
    // quotes years later.
    await expect(page.getByLabel("Role code")).toHaveValue(code);
    await page.getByTestId("create-role").click();
    made.push(code);

    // In force immediately: the matrix reads the `roles` table, which
    // `_permissions_for` also reads on every request — no re-login, no cache.
    // `.first()` throughout: AntD renders the header of a table with a fixed
    // column *twice* — once in the fixed layer and once in the scrolling one —
    // so every control in a column heading has two copies in the DOM.
    await expect(
      page.getByRole("columnheader", { name: new RegExp(name) }).first(),
    ).toBeVisible();

    // From the strip above the matrix, which is where the one destructive
    // control on this page lives — the column headings are 150 pixels wide
    // inside a table that scrolls sideways, and a control there is both
    // cramped and, once scrolled, unreachable.
    await expect(page.getByTestId("custom-roles")).toBeVisible();
    await page.getByTestId(`delete-role-${code}`).click();
    await expect(page.getByText(`Delete ${name}?`)).toBeVisible();
    await page.getByRole("button", { name: "Delete", exact: true }).click();

    // Asserted after a reload, and on the *control* rather than the column
    // heading: the fixed-column table keeps a heading in its DOM through a
    // re-render, so a count of headings is a claim about AntD's internals.
    // Whether the role exists is whether it can still be deleted.
    await page.reload();
    await expect(page.getByTestId("new-role")).toBeVisible();
    await expect(page.getByTestId(`delete-role-${code}`)).toHaveCount(0);
    made.length = 0;
  });

  test("a built-in role offers no delete at all", async ({ page }) => {
    await signIn(page, "admin", "/admin/roles");
    await expect(page.getByTestId("new-role")).toBeVisible();

    // The seed writes these five and `--sync-roles` maintains them, so a
    // deleted one comes back on the next deploy. Absent, not disabled: it is
    // not a thing anybody may do.
    for (const code of ["ADMINISTRATOR", "MANAGER", "OPERATOR", "ANALYST", "VIEWER"]) {
      await expect(page.getByTestId(`delete-role-${code}`)).toHaveCount(0);
    }
    // And with nothing added, the strip is not drawn at all rather than drawn
    // empty.
    await expect(page.getByTestId("custom-roles")).toHaveCount(0);
  });
});
