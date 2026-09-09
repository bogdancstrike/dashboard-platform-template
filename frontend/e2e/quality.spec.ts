import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * Data quality against the real stack (§65).
 *
 * The claim only a browser and a database together can make: **the count and
 * the rows are the same question**. The check is declared as the list's own
 * filter, so this reads a number off the quality page, follows its link, and
 * compares it with the count the *list* computes from the server. A check
 * counted one way and linked another would disagree here rather than on
 * somebody's screen months later.
 *
 * Also, and only reachable through a browser: that the indicator on an entity
 * list points at the page which explains it.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

test("the page says what it checked, not only what it found", async ({ page }) => {
  await signIn(page, "admin", "/admin/quality");

  await expect(page.getByTestId("quality-totals")).toBeVisible();
  await expect(page.getByTestId("quality-findings")).toBeVisible();
  // A page listing only problems cannot be told apart from a page whose checks
  // are broken, so the empty ones are drawn too.
  await expect(page.getByTestId("quality-passing")).toBeVisible();
});

test("a count opens exactly the rows it counted", async ({ page }) => {
  await signIn(page, "admin", "/admin/quality");
  await expect(page.getByTestId("quality-findings")).toBeVisible();

  // The first finding that *has* a link: the ones without are the checks a
  // filter cannot express, and they are covered below.
  const open = page.locator('[data-testid^="quality-open-"]').first();
  await expect(open).toBeVisible();
  const shown = Number(((await open.textContent()) ?? "").replace(/[^\d]/g, ""));
  expect(shown).toBeGreaterThan(0);

  await open.click();
  // The list's own header count is the server's over the whole filtered set,
  // which is the number the check computed. Same question, two screens.
  await expect(page.getByTestId("entity-total")).toBeVisible();
  const header = (await page.getByTestId("entity-total").textContent()) ?? "";
  const listed = Number((header.split(" of ")[0] ?? "").replace(/[^\d]/g, ""));
  expect(listed).toBe(shown);
});

test("a check a filter cannot express names its records instead", async ({ page }) => {
  await signIn(page, "admin", "/admin/quality?resource_type=project");
  const overspent = page.getByTestId("quality-project_overspent");
  await expect(overspent).toBeVisible();

  // No link, and the page says why rather than offering one that would open
  // the wrong rows.
  await expect(page.getByTestId("quality-open-project_overspent")).toHaveCount(0);
  await expect(overspent).toContainText("compares two columns");

  const sample = page.getByTestId("quality-sample-project_overspent");
  const first = sample.getByRole("link").first();
  await expect(first).toBeVisible();
  await first.click();
  // And each named record opens on its own page, so the finding is actionable
  // without a list.
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
  await expect(page.locator("#nu-main")).not.toContainText("Page not found");
});

test("a list's indicator opens the page that explains it", async ({ page }) => {
  await signIn(page, "admin", "/tickets");
  const chip = page.getByTestId("entity-quality");
  // The seeded dataset really does have unassigned open tickets, so the chip
  // is there — and if it ever is not, this fails rather than passing quietly.
  await expect(chip).toBeVisible();

  await chip.click();
  await expect(page).toHaveURL(/\/admin\/quality\?resource_type=ticket/);
  // Narrowed to that dataset, which is what the address said.
  await expect(page.getByTestId("quality-findings")).toBeVisible();
  await expect(page.getByTestId("quality-findings")).toContainText("Tickets");
  await expect(page.getByTestId("quality-findings")).not.toContainText("Orders");
});

test("narrowing to one dataset survives being pasted as a link", async ({ page }) => {
  await signIn(page, "admin", "/admin/quality?resource_type=order");
  await expect(page.getByTestId("quality-order_shipped_unpaid")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("quality-order_shipped_unpaid")).toBeVisible();
});

test.describe("what a viewer is shown", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("reading a list is enough to be told it contradicts itself", async ({ page }) => {
    // `records.view` and nothing narrower. A separate permission would let an
    // installation grant somebody a list and withhold the news about it.
    await signIn(page, "viewer", "/admin/quality");
    await expect(page.getByTestId("quality-totals")).toBeVisible();
    await expect(page.getByTestId("quality-findings")).toBeVisible();
  });
});

test("the page is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/admin/quality");
  await expect(page.getByTestId("quality-findings")).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

  const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
  const serious = audit.violations.filter((violation) =>
    ["serious", "critical"].includes(violation.impact ?? ""),
  );
  expect(
    serious.map((violation) => ({
      id: violation.id,
      nodes: violation.nodes.map((node) => `${node.target.join(" ")} :: ${node.failureSummary}`),
    })),
  ).toEqual([]);
});
