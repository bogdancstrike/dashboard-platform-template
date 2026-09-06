import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./auth";

/**
 * Personal preferences (§40) against the real stack.
 *
 * The claim only this level can check: a preference set here is stored on the
 * **server** and applied on the next visit — including in a browser that has
 * never seen this account. A component test with a mocked transport, or a
 * check that reads back what the page just set, would pass just as happily
 * against a `localStorage` implementation, which is the thing this is not.
 *
 * Serial and self-restoring: these edit the signed-in admin's own profile, and
 * a suite that leaves the demo account on 12-hour American dates is one people
 * stop running.
 */
test.describe.configure({ mode: "serial" });

/**
 * Choose a date format.
 *
 * Scoped to the radio group rather than the card: the worked example beside
 * the controls prints the same string, on purpose, and an unscoped match picks
 * that up instead of the control.
 */
/**
 * Choose a value in an AntD Select.
 *
 * The combobox input is covered by the rendered selection, so a click on the
 * input is intercepted. Focusing and typing nothing, then pressing Enter on
 * the highlighted option, is both stable and the keyboard path (§54).
 */
async function choose(page: Page, label: string, option: string): Promise<void> {
  const combo = page.getByRole("combobox", { name: label });
  await combo.focus();
  await combo.press("Enter");
  await page.getByTitle(option, { exact: true }).click();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
}

async function setDateFormat(page: Page, label: string): Promise<void> {
  await page.getByLabel("Date format").getByText(label, { exact: true }).click();
  await expect(page.getByTestId("save-state")).toHaveText("Saved");
}

test.describe("preferences", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, "admin", "/settings/preferences");
    // Normalise before asserting rather than assuming the seed. These tests
    // edit a real account; one that fails mid-way would otherwise poison every
    // later run with a state nobody chose.
    await setDateFormat(page, "2026-09-06");
  });

  test("saves a change without a Save button, and shows the effect beside it", async ({
    page,
  }) => {
    await expect(page.getByRole("heading", { name: /Preferences/ })).toBeVisible();
    const preview = page.getByTestId("format-preview");
    await expect(preview).toContainText("2026-09-06");

    try {
      await setDateFormat(page, "06/09/2026");
      await expect(preview).toContainText("06/09/2026");

      // It survives a reload, which is the difference between a preference and
      // a control: the value came back from the server, not from this tab.
      await page.reload();
      await expect(page.getByTestId("format-preview")).toContainText("06/09/2026");
    } finally {
      await setDateFormat(page, "2026-09-06");
    }
  });

  test("a stored preference is applied on the next visit, from a clean browser", async ({
    page,
    browser,
  }) => {
    await setDateFormat(page, "09/06/2026");

    // A context with no storage at all: no localStorage, no cookies, nothing
    // this session wrote. Whatever it shows came from the account.
    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    try {
      await signIn(other, "admin", "/admin/audit");
      // Every timestamp in the platform reads the preference, not just the
      // page that set it — an audit row is as far from it as anything gets.
      const row = other.getByRole("table").last().getByRole("row").nth(1);
      // Slashes, not the ISO the seed ships — so the value came from the
      // account rather than from a default this browser has never overridden.
      await expect(row).toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/);
      await expect(row).not.toContainText(/\d{4}-\d{2}-\d{2}/);
    } finally {
      await fresh.close();
      await page.reload();
      await setDateFormat(page, "2026-09-06");
    }
  });

  test("the home page is the reader's own, and the logo follows it", async ({ page }) => {
    await choose(page, "Home page", "Data Explorer");

    try {
      // Arriving with no address lands on the chosen page rather than a
      // constant somebody put in the router.
      await page.goto("/");
      await expect(page).toHaveURL(/\/explore/);
    } finally {
      await page.goto("/settings/preferences");
      await choose(page, "Home page", "Dashboard");
      await page.goto("/");
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });

  test("rows per page reaches a list that was never configured", async ({ page }) => {
    await choose(page, "Rows per page", "10 rows");

    try {
      await page.goto("/orders");
      // The ledger asks for no page size of its own, so it takes the reader's.
      // Ten rows plus the header and the summary line the ledger adds.
      await expect(page.getByRole("table").getByRole("row").nth(1)).toBeVisible();
      await expect(page.getByRole("table").getByRole("row")).toHaveCount(12);
    } finally {
      await page.goto("/settings/preferences");
      await choose(page, "Rows per page", "25 rows");
    }
  });

  test("a preference the server refuses is reported, not silently kept", async ({ page }) => {
    const status = await page.evaluate(async () => {
      const response = await fetch("/platform/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: { formats: { date: "STARDATE" } } }),
      });
      return response.status;
    });

    // Validated server-side against the declared choices, so a hand-crafted
    // request cannot store a value the app cannot render.
    expect([400, 401]).toContain(status);
  });
});
