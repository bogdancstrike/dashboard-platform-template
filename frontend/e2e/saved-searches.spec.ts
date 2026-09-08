import { expect, test, type Page } from "@playwright/test";

import { sweepSavedSearches } from "./api";
import { signIn, storageStateFor, type Persona } from "./auth";

/**
 * Saved searches and their sharing model (§5), against the real stack.
 *
 * The rules under test are the ones that decide whether anybody trusts the
 * panel: a private search is invisible to everyone else, a shared one is
 * readable and not editable, and only the owner can rename, re-share or delete.
 * Those are enforced in SQL and asserted here through two real signed-in
 * browsers, because a permission that only the UI enforces is not enforced.
 */

/**
 * A name no other run will produce, remembered so it can be cleaned up.
 *
 * Two things went wrong before this. There was no cleanup at all when a test
 * failed, so leftovers piled up on the panel — until one whose random suffix
 * contained the letters "ok" made `getByRole("button", {name: "OK"})` match
 * that row's four buttons as well as the dialog's, because Playwright matches
 * an accessible name by substring. And the first sweep matched a *prefix*,
 * which under `fullyParallel` deleted a sibling test's search while it was
 * still using it: the explorer then showed every record, and the failure read
 * as "the saved search did not restore its question".
 *
 * So each test remembers exactly what it made, and the sweep deletes exactly
 * that.
 */
const created: { name: string; owner: Persona }[] = [];

function uniqueName(label: string, owner: Persona = "admin"): string {
  return alsoCreated(
    `E2E search ${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`,
    owner,
  );
}

/**
 * Remember a name this test is responsible for, and who owns it.
 *
 * The owner matters: only the owner may delete a saved search (§5), so a
 * sweep that used the admin token for all of them would silently fail to
 * remove the viewer's and the one that was handed to Mara — and silently is
 * how the panel filled up in the first place.
 */
function alsoCreated(name: string, owner: Persona = "admin"): string {
  created.push({ name, owner });
  return name;
}

/** Gone however the test ended, so the panel does not fill up (§5). */
test.afterEach(async () => {
  const mine = created.splice(0, created.length);
  const byOwner = new Map<Persona, string[]>();
  for (const item of mine) {
    byOwner.set(item.owner, [...(byOwner.get(item.owner) ?? []), item.name]);
  }
  for (const [owner, names] of byOwner) {
    await sweepSavedSearches(names, owner);
  }
});

/**
 * Show the saved-search panel, whether or not it is already showing.
 *
 * Clicking the button when the drawer is open is not a no-op in a test: the
 * modal that was just dismissed is still fading out over it, and the click
 * lands on the overlay instead.
 */
async function openPanel(page: Page): Promise<void> {
  const panel = page.getByRole("dialog").filter({ hasText: "Saved searches" });
  if (await panel.isVisible()) return;

  // Waited for, not assumed present. `isVisible` is a point-in-time question
  // with no retry, and the explorer's toolbar renders after its catalogue
  // arrives — so on a loaded machine the click used to land before the button
  // existed, and the failure read as a missing panel rather than as a race.
  const trigger = page.getByRole("button", { name: "Saved searches" });
  await expect(trigger).toBeEnabled();
  await trigger.click();
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

/**
 * Delete one through the panel, which is a *claim* and not cleanup.
 *
 * Cleanup is the `afterEach` sweep. This is here for the one test that asserts
 * the delete flow itself — and it stopped being used by the others because
 * ending five tests by driving the same UI made every one of them flake on it:
 * the panel re-renders while the confirmation closes, and Playwright reported
 * "element is not stable" for thirty seconds on a button that works.
 */
async function deleteSearch(page: Page, name: string): Promise<void> {
  await openPanel(page);
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
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
  });

  test("renaming and describing one keeps its question", async ({ page }) => {
    const name = uniqueName("Before");
    // Registered too: a rename means the sweep is looking for a name that no
    // longer exists, and the row it left behind would be the next leftover.
    const renamed = alsoCreated(`${name} after`);
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

    // The one place the delete flow itself is asserted: it says so, and the
    // row goes. Everywhere else the `afterEach` sweep does it through the API.
    await deleteSearch(page, renamed);
    await expect(page.getByRole("button", { name: renamed, exact: true })).toHaveCount(0);
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
  });

  test("handing one over makes the previous owner a reader", async ({ page }) => {
    // Owned by Mara by the time the test ends, so the sweep has to use her
    // token: only an owner may delete a saved search.
    const name = uniqueName("Handover", "manager");
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

    // Withdrawn by the sweep rather than by its new owner: the claim here is
    // about *ownership*, and driving a second browser's delete UI to tidy up
    // asserted nothing while flaking on the panel's re-render.
  });

  test("a role without sharing rights is told, not refused later", async ({ browser }) => {
    const context = await browser.newContext({ storageState: storageStateFor("viewer") });
    const viewer = await context.newPage();
    const name = uniqueName("Viewer private", "viewer");
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
    await context.close();
  });
});
