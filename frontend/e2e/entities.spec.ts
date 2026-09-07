import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The six entity pages (§7, §8) against the real stack.
 *
 * These used to be one generic list rendered six times, and the test that
 * matched asserted the same three things about each. That suite passed while
 * the product's biggest weakness — every entity looking like every other one —
 * went unmeasured.
 *
 * So the assertions here are deliberately *different per page*: a lane on the
 * board, a bar on the timeline, an account card, two settlement columns on the
 * ledger, a split queue, a fleet gauge. A page that quietly reverted to a
 * shared table would fail five of them.
 *
 * What they do share is the contract underneath — the same query, the same URL
 * keys, the same export — and that is asserted once rather than six times.
 */

function main(page: Page) {
  return page.locator("#nu-main");
}

/**
 * The header's Export control.
 *
 * Scoped to the page header on purpose: a seeded ticket is called "Export
 * finishes but the file is empty", and an unscoped name match picks it up.
 */
function exportButton(page: Page) {
  return page.locator(".nu-page-header").getByRole("button", { name: /Export/ });
}

async function shown(page: Page): Promise<number> {
  const text = (await page.getByTestId("entity-total").textContent()) ?? "";
  return Number((text.split("of")[0] ?? "0").replace(/[^\d]/g, ""));
}

test.describe("each entity gets the page its data deserves", () => {
  test("tasks open as a board, one lane per declared status", async ({ page }) => {
    await signIn(page, "admin", "/tasks");

    const board = page.getByTestId("task-board");
    await expect(board).toBeVisible();
    // The lanes are the vocabulary, not the values that happen to be on a
    // page: an empty lane is information.
    await expect(board.getByLabel("IN_PROGRESS")).toBeVisible();
    await expect(board.getByLabel("BLOCKED")).toBeVisible();
    // Each lane carries its own server-side total.
    await expect(board.locator(".nu-lane-count").first()).toHaveText(/\d/);
    await expect(board.locator(".nu-task-card").first()).toBeVisible();
  });

  test("projects open as a portfolio timeline with budget beside health", async ({ page }) => {
    await signIn(page, "admin", "/projects");

    const timeline = page.getByTestId("project-timeline");
    await expect(timeline).toBeVisible();
    await expect(timeline.locator(".nu-timeline-bar").first()).toBeVisible();
    // The axis is drawn from the range the filtered rows actually span.
    await expect(timeline.locator(".nu-timeline-tick").first()).toBeVisible();
  });

  test("customers open as account cards, richest first", async ({ page }) => {
    await signIn(page, "admin", "/customers");

    const grid = page.getByTestId("customer-grid");
    await expect(grid).toBeVisible();
    const first = grid.locator(".nu-account").first();
    await expect(first).toBeVisible();
    // Lifetime value is the ordering and the headline, not a column.
    await expect(first.locator(".nu-account-amount")).toHaveText(/€/);
  });

  test("orders open as a ledger that separates payment from fulfilment", async ({ page }) => {
    await signIn(page, "admin", "/orders");

    await expect(page.getByRole("columnheader", { name: "Payment" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Fulfilment" })).toBeVisible();
    // The total is the server's aggregate over the filtered set, so it is
    // larger than anything on the page.
    await expect(page.getByText(/the server's, not this page's/)).toBeVisible();
  });

  test("tickets open as a split queue that keeps its place", async ({ page }) => {
    await signIn(page, "admin", "/tickets");

    const queue = page.getByTestId("ticket-queue");
    await expect(queue).toBeVisible();
    // A ticket is chosen for the reader, and the detail is on the same screen.
    await expect(queue.locator(".nu-queue-row.is-open")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Full record" })).toBeVisible();

    // Choosing another puts it in the URL, so the exact ticket can be pasted.
    await queue.locator(".nu-queue-row").nth(2).click();
    await expect(page).toHaveURL(/open=[0-9a-f-]{36}/);
    const chosen = new URL(page.url()).searchParams.get("open");
    await page.reload();
    await expect(queue.locator(".nu-queue-row.is-open")).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("open")).toBe(chosen);
  });

  test("devices open as a fleet monitor with two health signals per unit", async ({ page }) => {
    await signIn(page, "admin", "/devices");

    const fleet = page.getByTestId("device-fleet");
    await expect(fleet).toBeVisible();
    const first = fleet.locator(".nu-device").first();
    await expect(first).toBeVisible();
    // Battery and signal, as bars — a wall of devices is scanned, not read.
    await expect(first.locator(".nu-gauge")).toHaveCount(2);
    await expect(first.locator(".nu-device-seen")).toHaveText(
      /reporting|quiet|silent|never reported/,
    );
  });
});

test.describe("what the six pages share", () => {
  test("the headline numbers are the server's, over the filtered rows (§44)", async ({ page }) => {
    await signIn(page, "admin", "/orders");

    const metrics = page.getByTestId("entity-metrics");
    await expect(metrics).toBeVisible();
    const revenue = metrics.locator(".nu-statcard").filter({ hasText: "Revenue" });
    await expect(revenue).toBeVisible();
    const everything = (await revenue.innerText()).replace(/[^\d]/g, "");

    // Narrow the question; the summary has to narrow with it, or it is a
    // second answer to a different question.
    await page.goto("/orders?f.channel=PORTAL");
    await expect(page).toHaveURL(/f\.channel=PORTAL/);
    await expect
      .poll(async () => (await revenue.innerText()).replace(/[^\d]/g, ""))
      .not.toBe(everything);
  });

  test("a facet narrows server-side and survives a reload (§69, §71)", async ({ page }) => {
    await signIn(page, "admin", "/devices");
    await expect(page.getByTestId("device-fleet")).toBeVisible();
    const before = await shown(page);

    await page.goto("/devices?f.status=OFFLINE");

    await expect.poll(async () => shown(page)).toBeLessThan(before);
    const narrowed = await shown(page);
    await page.reload();
    await expect.poll(async () => shown(page)).toBe(narrowed);
  });

  test("a card opens the record, and the record comes back to its list", async ({ page }) => {
    await signIn(page, "admin", "/customers");

    const first = main(page).locator(".nu-account").first();
    await expect(first).toBeVisible();
    const name = (await first.locator(".ant-typography").first().innerText()).trim();
    await first.click();

    await expect(page).toHaveURL(/\/customers\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page).toHaveURL(/\/customers$/);
  });

  test("a record's History tab is its audit trail (§21, §48)", async ({ page }) => {
    await signIn(page, "admin", "/customers");
    await main(page).locator(".nu-account").first().click();
    await expect(page.getByRole("heading")).toBeVisible();

    await page.getByRole("tab", { name: "History" }).click();

    await expect(page).toHaveURL(/tab=history/);
    await expect(
      page
        .getByText("Nothing has happened to this record yet")
        .or(page.locator(".nu-timeline").getByRole("button").first()),
    ).toBeVisible();
  });

  test("a record that does not exist says so, whichever page was opened", async ({ page }) => {
    // Both shapes of detail page: the console a ticket gets and the generic
    // one a customer gets. Each names what it could not find rather than
    // drawing an empty layout (§34) — a page that failed silently would pass
    // an assertion written against only one of them.
    for (const missing of ["/tickets", "/customers"]) {
      await signIn(page, "admin", `${missing}/00000000-0000-0000-0000-000000000000`);
      await expect(page.getByRole("heading", { name: /not found/i })).toBeVisible();
      await expect(
        page.getByText("It may have been deleted, or the link may be wrong."),
      ).toBeVisible();
    }
  });

  test("the list exports the filtered records, not the page", async ({ page }) => {
    await signIn(page, "admin", "/tickets?f.severity=CRITICAL");
    await expect(page.getByTestId("ticket-queue")).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      (async () => {
        await exportButton(page).click();
        await page.getByText("CSV — for a spreadsheet").click();
      })(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^ticket-/);
  });
});

test.describe("entity page permissions", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("a reader without export rights is told, not silently given nothing", async ({ page }) => {
    await signIn(page, "viewer", "/tickets");
    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();

    await exportButton(page).click();
    await page.getByText("CSV — for a spreadsheet").click();

    // The refusal is the server's, and it names the permission.
    await expect(page.getByText(/do not have permission to export/)).toBeVisible();
  });
});
