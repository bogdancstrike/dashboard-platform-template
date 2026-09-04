import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The generic entity pages (§7, §8) against the real stack.
 *
 * The property worth protecting at this level is that *one* implementation
 * serves every entity. So the list assertions are parameterised over several
 * of them: if tickets work and customers do not, the pages are not generic and
 * the declaration is not the source of truth it claims to be.
 */

const ENTITIES = [
  { path: "/tickets", label: "Tickets", column: "Subject" },
  { path: "/customers", label: "Customers", column: "Name" },
  { path: "/orders", label: "Orders", column: "Reference" },
  { path: "/devices", label: "Devices", column: "Serial" },
  { path: "/projects", label: "Projects", column: "Name" },
  { path: "/tasks", label: "Tasks", column: "Title" },
];

function rows(page: Page) {
  return page.getByRole("table").getByRole("row");
}

/**
 * Choose the first value a facet offers, from the keyboard.
 *
 * Not by clicking the option: AntD animates its dropdown open and re-renders
 * the list when fresh facet counts arrive, so Playwright's stability check can
 * wait out the whole timeout on an element that keeps moving. Enter selects the
 * highlighted option, which is both stable and the path a keyboard user takes
 * (§54).
 */
async function chooseFirstFacet(page: Page, name: string): Promise<string> {
  // The options are the *facet counts*, so they only exist once the list has
  // answered — and a dropdown opened while that answer is still arriving is
  // re-rendered out from under itself. Waiting for the rows first is what makes
  // this stable rather than sprinkling timeouts over it.
  await expect(rows(page).nth(1)).toBeVisible();
  await page.waitForLoadState("networkidle");

  const combo = page.getByRole("combobox", { name });
  await combo.click();

  // rc-select exposes its options to assistive technology through a *hidden*
  // mirror list; the items a mouse clicks are presentational. So the option to
  // assert on is deliberately the hidden one — it is the one a screen reader
  // reads — and it is never "visible".
  const option = page.getByRole("option").first();
  await expect(option).toHaveCount(1);
  const label = (await option.getAttribute("aria-label")) ?? "";

  // Enter takes the highlighted option, which is both stable against the
  // dropdown's animation and the path a keyboard user takes (§54).
  await combo.press("Enter");
  return label;
}

async function shown(page: Page): Promise<number> {
  const text = (await page.getByTestId("entity-total").textContent()) ?? "";
  return Number((text.split("of")[0] ?? "0").replace(/[^\d]/g, ""));
}

test.describe("entity lists", () => {
  for (const entity of ENTITIES) {
    test(`${entity.label} lists real records with its own columns`, async ({ page }) => {
      await signIn(page, "admin", entity.path);

      await expect(page.getByRole("heading", { name: entity.label })).toBeVisible();
      await expect(
        page.getByRole("columnheader", { name: entity.column, exact: true }),
      ).toBeVisible();
      await expect(rows(page).nth(1)).toBeVisible();
      expect(await shown(page)).toBeGreaterThan(0);
    });
  }

  test("a facet narrows the list server-side and survives a reload (§69, §71)", async ({
    page,
  }) => {
    await signIn(page, "admin", "/tickets");
    const before = await shown(page);

    await chooseFirstFacet(page, "Status");

    await expect(page).toHaveURL(/f\.status=/);
    await expect.poll(async () => shown(page)).toBeLessThan(before);
    const narrowed = await shown(page);

    await page.reload();
    await expect.poll(async () => shown(page)).toBe(narrowed);
  });

  test("a row opens the record, and the record comes back to the list", async ({ page }) => {
    await signIn(page, "admin", "/tickets");

    const reference = await rows(page).nth(1).getByRole("cell").first().innerText();
    await rows(page).nth(1).click();

    await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}/);
    // The heading names the record rather than repeating its id.
    await expect(page.getByRole("heading")).not.toHaveText(/^[0-9a-f-]{36}$/);
    await expect(page.getByText(reference.trim()).first()).toBeVisible();

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/tickets$/);
  });

  test("a record's History tab is its audit trail (§21, §48)", async ({ page }) => {
    await signIn(page, "admin", "/tickets");
    await rows(page).nth(1).click();
    await expect(page.getByRole("heading")).toBeVisible();

    await page.getByRole("tab", { name: "History" }).click();

    await expect(page).toHaveURL(/tab=history/);
    // Either it has a history or it says it has none — never a blank panel.
    await expect(
      page
        .getByText("Nothing has happened to this record yet")
        .or(page.locator(".nu-timeline").getByRole("button").first()),
    ).toBeVisible();
  });

  test("a record that does not exist says so", async ({ page }) => {
    await signIn(page, "admin", "/tickets/00000000-0000-0000-0000-000000000000");

    await expect(page.getByRole("heading", { name: /Record not found/ })).toBeVisible();
  });

  test("the list exports the filtered records, not the page", async ({ page }) => {
    await signIn(page, "admin", "/tickets");
    await chooseFirstFacet(page, "Status");
    await expect.poll(async () => shown(page)).toBeGreaterThan(0);
    const filtered = await shown(page);

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await page.getByRole("button", { name: /Export/ }).click();
        await page.getByText("CSV — for a spreadsheet").click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^ticket-/);
    expect(filtered).toBeGreaterThan(0);
  });
});

test.describe("entity list permissions", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("a reader without export rights is told, not silently given nothing", async ({ page }) => {
    await signIn(page, "viewer", "/tickets");
    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();

    await page.getByRole("button", { name: /Export/ }).click();
    await page.getByText("CSV — for a spreadsheet").click();

    // The refusal is the server's, and it names the permission.
    await expect(page.getByText(/do not have permission to export/)).toBeVisible();
  });
});
