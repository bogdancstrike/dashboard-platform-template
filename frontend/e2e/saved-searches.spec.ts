import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * Saved searches and their sharing model (§5), against the real stack.
 *
 * The rules under test are the ones that decide whether anybody trusts the
 * panel: a private search is invisible to everyone else, a shared one is
 * readable and not editable, and only the owner can rename, re-share or delete.
 * Those are enforced in SQL and asserted here through two real signed-in
 * browsers, because a permission that only the UI enforces is not enforced.
 */

/** Unique per run, so a failed run leaves nothing that breaks the next one. */
function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
}

/**
 * Show the saved-search panel, whether or not it is already showing.
 *
 * Clicking the button when the drawer is open is not a no-op in a test: the
 * modal that was just dismissed is still fading out over it, and the click
 * lands on the overlay instead.
 */
async function openPanel(page: Page): Promise<void> {
  const panel = page.getByRole("dialog").filter({ hasText: "Saved searches" });
  if (!(await panel.isVisible())) {
    await page.getByRole("button", { name: "Saved searches" }).click();
  }
  await expect(panel).toBeVisible();
}

/**
 * A dismissed dialog is still on screen while it fades, and its overlay eats
 * the next click. Waiting for it to leave is the difference between a suite
 * that passes and one that passes on a fast machine.
 */
async function awaitDialogsClosed(page: Page): Promise<void> {
  await expect(page.locator(".ant-modal-wrap")).toHaveCount(0);
}

async function saveCurrentSearch(page: Page, name: string): Promise<void> {
  // The button's accessible name carries its icon's label too, so it is
  // addressed by test id rather than by a name that reads as "save Save".
  await page.getByTestId("save-search").click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Save search" }).click();
  await expect(page.getByText("Search saved")).toBeVisible();
  await awaitDialogsClosed(page);
}

/** Remove it however the run ended, so the next run starts clean. */
async function deleteSearch(page: Page, name: string): Promise<void> {
  await openPanel(page);
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await page.getByRole("button", { name: "OK" }).click();
  await expect(page.getByText("Saved search deleted")).toBeVisible();
}

test.describe("saved searches", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/explore"));

  test("stores the question and the presentation, and restores both", async ({ page }) => {
    const name = uniqueName("Critical only");

    // A question worth saving: a condition, a term and a presentation.
    await page.getByPlaceholder("Search tasks, and everywhere else…").fill("audit");
    await page.getByTestId("view-mode").getByText("Cards", { exact: true }).click();
    await expect(page.getByTestId("explorer-settling")).toBeHidden();
    const matches = await page.getByTestId("explorer-match-count").innerText();

    await saveCurrentSearch(page, name);

    // Come back with nothing in the URL; opening it has to restore everything.
    await page.goto("/explore");
    await openPanel(page);
    await page.getByRole("button", { name: name, exact: true }).click();

    await expect(page.getByTestId("explorer-match-count")).toHaveText(matches);
    expect(new URL(page.url()).searchParams.get("q")).toBe("audit");
    expect(new URL(page.url()).searchParams.get("view")).toBe("cards");

    await deleteSearch(page, name);
  });

  test("renaming and describing one keeps its question", async ({ page }) => {
    const name = uniqueName("Before");
    const renamed = `${name} after`;
    await saveCurrentSearch(page, name);

    await openPanel(page);
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await page.getByLabel("Name", { exact: true }).fill(renamed);
    await page.getByLabel("Description", { exact: true }).fill("Why this question matters");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved search updated")).toBeVisible();
    await awaitDialogsClosed(page);

    await expect(page.getByRole("button", { name: renamed, exact: true })).toBeVisible();
    await expect(page.getByText("Why this question matters").first()).toBeVisible();

    await deleteSearch(page, renamed);
  });

  test("a private search is invisible to a colleague", async ({ page, browser }) => {
    const name = uniqueName("Mine alone");
    await saveCurrentSearch(page, name);

    const other = await browser.newContext({ storageState: storageStateFor("manager") });
    const colleague = await other.newPage();
    await signIn(colleague, "manager", "/explore");
    await openPanel(colleague);
    await expect(colleague.getByRole("button", { name: name, exact: true })).toBeHidden();
    await other.close();

    await deleteSearch(page, name);
  });

  test("a named colleague can run it and cannot change it", async ({ page, browser }) => {
    const name = uniqueName("Shared with Mara");
    await saveCurrentSearch(page, name);

    await openPanel(page);
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await page.getByTestId("saved-search-scope").getByText("Shared", { exact: true }).click();
    await page.getByTestId("saved-search-members").click();
    await page.keyboard.type("Mara");
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
      .filter({ has: page.getByText("Mara Manager", { exact: true }) })
      .first()
      .click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved search updated")).toBeVisible();
    await awaitDialogsClosed(page);

    const other = await browser.newContext({ storageState: storageStateFor("manager") });
    const colleague = await other.newPage();
    await signIn(colleague, "manager", "/explore");
    await openPanel(colleague);

    // Visible and runnable…
    await expect(colleague.getByRole("button", { name: name, exact: true })).toBeVisible();
    // …but none of the owner's controls are offered.
    await expect(colleague.getByRole("button", { name: `Edit ${name}` })).toBeHidden();
    await expect(colleague.getByRole("button", { name: `Delete ${name}` })).toBeHidden();
    // Duplicating is how a member gets a version of their own.
    await expect(colleague.getByRole("button", { name: `Duplicate ${name}` })).toBeVisible();
    await other.close();

    await deleteSearch(page, name);
  });

  test("handing one over makes the previous owner a reader", async ({ page }) => {
    const name = uniqueName("Handover");
    await saveCurrentSearch(page, name);

    await openPanel(page);
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    await page.getByTestId("saved-search-heir").click();
    await page.keyboard.type("Mara");
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
      .filter({ has: page.getByText("Mara Manager", { exact: true }) })
      .first()
      .click();
    await page.getByRole("button", { name: "Transfer ownership" }).click();
    await page.getByRole("button", { name: "Transfer", exact: true }).click();
    await expect(page.getByText(/now belongs to Mara Manager/)).toBeVisible();
    await awaitDialogsClosed(page);

    // Still on the list, still runnable, no longer editable by the giver.
    await openPanel(page);
    const card = page.locator(".nu-saved-card").filter({ hasText: name });
    await expect(card.getByRole("button", { name: name, exact: true })).toBeVisible();
    await expect(card.getByText("by Mara Manager")).toBeVisible();
    await expect(page.getByRole("button", { name: `Edit ${name}` })).toBeHidden();

    // Cleaned up by its new owner, who is the only one who can.
    const other = await page.context().browser()!.newContext({
      storageState: storageStateFor("manager"),
    });
    const owner = await other.newPage();
    await signIn(owner, "manager", "/explore");
    await deleteSearch(owner, name);
    await other.close();
  });

  test("a role without sharing rights is told, not refused later", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStateFor("viewer") });
    const viewer = await context.newPage();
    const name = uniqueName("Viewer private");
    await signIn(viewer, "viewer", "/explore");

    await viewer.getByTestId("save-search").click();
    await viewer.getByLabel("Name", { exact: true }).fill(name);

    await expect(
      viewer.getByText("Your role can keep private searches, not publish them"),
    ).toBeVisible();
    await expect(
      viewer.getByTestId("saved-search-scope").getByRole("radio", { name: "Public" }),
    ).toBeDisabled();

    await viewer.getByRole("button", { name: "Save search" }).click();
    await expect(viewer.getByText("Search saved")).toBeVisible();
    await awaitDialogsClosed(viewer);

    await deleteSearch(viewer, name);
    await context.close();
  });
});
