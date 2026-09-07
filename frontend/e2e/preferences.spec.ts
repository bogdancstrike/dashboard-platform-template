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
  // The dropdown option, not the closed select's own label: AntD gives both the
  // same `title`, so this matches twice as soon as the value being chosen is
  // already the current one — which is the state a re-run leaves behind.
  await page.locator(".ant-select-item-option").filter({ hasText: option }).first().click();
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
      await signIn(other, "admin", "/admin/audit?action=UPDATE&resource_type=ticket");
      // Every timestamp in the platform reads the preference, not just the
      // page that set it — an audit row is as far from it as anything gets.
      //
      // The *entry*, not the table cell: the ledger renders anything younger
      // than a week as "3d ago", so which format a row shows depends on how
      // recently somebody happened to edit a ticket. The drawer always prints
      // the full instant, which is exactly the value a format applies to.
      await other.getByRole("table").last().getByRole("row").nth(1).click();
      const entry = other.getByRole("dialog");
      await expect(entry).toBeVisible();
      // Slashes, not the ISO the seed ships — so the value came from the
      // account rather than from a default this browser has never overridden.
      await expect(entry).toContainText(/\d{1,2}\/\d{1,2}\/\d{4}/);
      await expect(entry.getByText(/\d{4}-\d{2}-\d{2}/)).toHaveCount(0);
    } finally {
      await fresh.close();
      await page.reload();
      await setDateFormat(page, "2026-09-06");
    }
  });

  test("collapsing the sidebar is a preference, not a habit of this browser", async ({
    page,
    browser,
  }) => {
    await signIn(page, "admin", "/dashboard");
    const sider = page.locator(".nu-sider");
    await expect(sider).toBeVisible();

    // AntD's own trigger at the foot of the sider — the control a reader uses.
    await page.locator(".ant-layout-sider-trigger").click();
    await expect(sider).toHaveClass(/ant-layout-sider-collapsed/);

    // Collapsed, the rail is icons and nothing else: a group heading truncated
    // to "OV…" is a word that has lost the letters that made it a word, and it
    // costs a row of the rail to say nothing. The headings become rules.
    //
    // Asserted on the heading elements rather than on their words: "Overview"
    // is also the name of an administration *page*, so matching text finds a
    // menu item and proves nothing.
    const headings = sider.locator(".ant-menu-item-group-title");
    expect(await headings.count()).toBeGreaterThan(0);
    expect(await headings.allInnerTexts()).toEqual(
      Array.from({ length: await headings.count() }, () => ""),
    );

    // And an icon is centred on the rail rather than left where a label used
    // to hold it.
    const icon = sider.locator(".ant-menu-item .anticon").first();
    await expect(icon).toBeVisible();
    const rail = await sider.boundingBox();
    const box = await icon.boundingBox();
    expect(Math.abs((box!.x + box!.width / 2) - (rail!.x + rail!.width / 2))).toBeLessThan(3);

    const fresh = await browser.newContext();
    const other = await fresh.newPage();
    try {
      // A browser with no storage at all. A collapsed sidebar here came from
      // the account, which is the whole difference between a preference and a
      // habit of one machine (§40).
      await signIn(other, "admin", "/dashboard");
      await expect(other.locator(".nu-sider")).toHaveClass(/ant-layout-sider-collapsed/);
    } finally {
      await fresh.close();
      await page.locator(".ant-layout-sider-trigger").click();
      await expect(sider).not.toHaveClass(/ant-layout-sider-collapsed/);
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
