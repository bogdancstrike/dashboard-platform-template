import { expect, test, type Page } from "@playwright/test";

import { sweepSavedSearches, writeSavedSearch } from "./api";
import { signIn, storageStateFor, type Persona } from "./auth";

/**
 * Saved views on an entity list, against the real stack (§46).
 *
 * A saved view *is* a saved search — the store §5 already has — reachable from
 * the lists rather than only from the Data Explorer. What only a browser can
 * check is the round trip: the question on screen is saved under a name, the
 * name brings the question back on a page that was opened with nothing in its
 * address, and the reader's default decides what a bare `/tasks` shows.
 *
 * Deliberately quiet about other people's runs. Every row created here is
 * private to its persona and swept by name however the test ends, and the
 * default is set on a dataset and a persona no other spec drives — a default
 * that outlived its test would change what a sibling spec's list shows, and
 * the failure would read as a product bug in whatever spec happened to run.
 */

const created: { name: string; owner: Persona }[] = [];

function uniqueName(label: string, owner: Persona = "admin"): string {
  const name = `E2E view ${label} ${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  created.push({ name, owner });
  return name;
}

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

/** The views menu, which every entity list carries from `EntityHeader`. */
async function openMenu(page: Page): Promise<void> {
  await expect(page.getByTestId("saved-views")).toBeEnabled();
  await page.getByTestId("saved-views").click();
  await expect(page.locator(".ant-dropdown:not(.ant-dropdown-hidden)")).toBeVisible();
}

function menuItem(page: Page, text: string) {
  return page
    .locator(".ant-dropdown:not(.ant-dropdown-hidden) .ant-dropdown-menu-item")
    .filter({ hasText: text })
    .first();
}

test.describe("saved views on a list", () => {
  test.use({ storageState: storageStateFor("admin") });

  test("saves the question on screen and brings it back by name", async ({ page }) => {
    const name = uniqueName("Blocked work");
    await signIn(page, "admin", "/tasks");

    // A question: one facet. Priority rather than status, because on this page
    // status is the lanes.
    // By role: AntD puts the `aria-label` on the wrapper *and* on the search
    // input inside it, so `getByLabel` matches two elements.
    await page.getByRole("combobox", { name: "Priority" }).click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
      .filter({ hasText: "CRITICAL" })
      .first()
      .click();
    await expect(page).toHaveURL(/f\.priority=CRITICAL/);

    await openMenu(page);
    await menuItem(page, "Save this view").click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save search" }).click();
    await expect(page.getByText("Search saved")).toBeVisible();

    // Saved *and applied*: the address names the view rather than the
    // anonymous question it was saved from.
    await expect(page).toHaveURL(/view=[0-9a-f-]{36}/);
    await expect(page.getByTestId("saved-views")).toContainText(name);

    // Now arrive with nothing in the address and choose it by name.
    await page.goto("/tasks");
    await expect(page).not.toHaveURL(/f\.priority/);
    await openMenu(page);
    await menuItem(page, name).click();

    await expect(page).toHaveURL(/f\.priority=CRITICAL/);
    await expect(page.getByTestId("saved-views")).toContainText(name);
  });

  test("a view built in the rule builder opens where it was built", async ({ page }) => {
    const name = uniqueName("Two rules");
    await writeSavedSearch({
      name,
      condition_tree: {
        type: "group",
        conjunction: "AND",
        children1: {
          priority: {
            type: "rule",
            properties: {
              field: "priority",
              operator: "select_any_in",
              value: [["HIGH", "CRITICAL"]],
            },
          },
        },
      },
    });

    await signIn(page, "admin", "/tasks");
    await openMenu(page);
    await menuItem(page, name).click();

    // Offered as a link rather than applied as the handful of facets it is
    // not: six selects cannot express "overdue OR unassigned", and showing a
    // different set of rows under its name would be worse than not offering it.
    await expect(page).toHaveURL(/\/explore\?saved=[0-9a-f-]{36}/);
  });
});

test.describe("the view a list opens with", () => {
  // An analyst on the fleet: no other spec lists devices as this persona, so a
  // default that somehow outlived its own test changes nothing anybody else
  // measures.
  test.use({ storageState: storageStateFor("analyst") });

  test("the reader's own default decides what a bare list shows", async ({ page }) => {
    const name = uniqueName("Fleet default", "analyst");
    await signIn(page, "analyst", "/devices");

    await page.getByRole("combobox", { name: "Status" }).click();
    await page
      .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
      .first()
      .click();
    await expect(page).toHaveURL(/f\.status=/);
    const chosen = new URL(page.url()).searchParams.get("f.status");

    await openMenu(page);
    await menuItem(page, "Save this view").click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByRole("button", { name: "Save search" }).click();
    await expect(page.getByText("Search saved")).toBeVisible();
    await expect(page).toHaveURL(/view=/);

    await openMenu(page);
    await menuItem(page, "Open this list with this view").click();
    await expect(page.getByText("will open with")).toBeVisible();

    // Arrive with nothing: the default is applied, by name and by question.
    await page.goto("/devices");
    await expect(page).toHaveURL(new RegExp(`f\\.status=${chosen}`));
    await expect(page.getByTestId("saved-views")).toContainText(name);

    // And an address that asks something of its own is not overruled by it.
    await page.goto("/devices?f.status=RETIRED");
    await expect(page.getByTestId("entity-total")).toBeVisible();
    await expect(page).toHaveURL(/f\.status=RETIRED/);

    // Stopped, so nothing outlives the test even if the sweep cannot delete.
    await page.goto(`/devices?view=${new URL(page.url()).searchParams.get("view") ?? ""}`);
    await page.goto("/devices");
    await openMenu(page);
    await menuItem(page, "Stop opening with this view").click();
    await expect(page.getByText("no longer the default")).toBeVisible();
  });
});
