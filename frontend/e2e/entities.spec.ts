import AxeBuilder from "@axe-core/playwright";
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

  test("projects open as a table whose standing is derived from its own columns", async ({
    page,
  }) => {
    await signIn(page, "admin", "/projects");

    const table = page.getByTestId("project-table");
    await expect(table).toBeVisible();
    const row = table.locator(".ant-table-row").first();
    await expect(row).toBeVisible();

    // The three numbers the page exists to compare, on one row: delivered,
    // schedule used, budget used — every one a percentage the reader can read
    // down its column.
    await expect(row.locator(".nu-meter-value")).toHaveText(/%$/);

    // And the verdict, which is not a stored field: it is what the gaps
    // between those three add up to, by the rule the delivery review uses.
    // "Behind" names which gap it is behind on, so the pattern allows the
    // qualifier — a column whose every row reads the same word carries no
    // information, and on this portfolio nearly every project is over its
    // money while several are ahead of their schedule.
    await expect(
      table
        .locator(".ant-table-row")
        .getByText(/^(Behind · (money|time|both)|Ahead|On line|Delivered)$/)
        .first(),
    ).toBeVisible();
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

  test("tickets open as a table whose loudest column is the clock", async ({ page }) => {
    await signIn(page, "admin", "/tickets");

    const queue = page.getByTestId("ticket-queue");
    await expect(queue).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Service level" })).toBeVisible();

    // The verdict is derived from the record's own timestamps, and it is
    // written in words rather than left to a colour (§64).
    await expect(
      queue.getByText(/^(SLA breached|Resolved|Resolved late|Due|Answered)/).first(),
    ).toBeVisible();

    // A row opens the console, which is where a ticket is worked on. The
    // preview pane that used to sit here was a second rendering of a record
    // that already has a page.
    await queue.locator(".ant-table-row").first().click();
    await expect(page).toHaveURL(/\/tickets\/[0-9a-f-]{36}/);
    await expect(page.getByTestId("ticket-triage")).toBeVisible();
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


test.describe("every one of the six lists is legible and keyboard-reachable", () => {
  /**
   * The audit none of these pages had (§55, §56, §59).
   *
   * Twelve specs audit a page each and these six had none, which is exactly
   * how the gap stays open: a rule that must be remembered per page covers the
   * pages somebody thought of. Running it found eight unnamed progress bars on
   * the board and one on the account grid — `role="progressbar"` takes no name
   * from its contents, so a bar with a percentage drawn inside it is still
   * announced as a number with no subject.
   *
   * `.ant-table-measure-row` is excluded, and only that. It is AntD's own
   * zero-height row for measuring column widths under `scroll.x`, carrying
   * `aria-hidden` and `tabindex="-1"` — not reachable by tab, not clickable,
   * and not ours to remove without giving up the sticky reference and action
   * columns three of these tables rely on. Everything else is asserted.
   */
  for (const [label, path] of [
    ["the board", "/tasks"],
    ["the portfolio", "/projects"],
    ["the account grid", "/customers"],
    ["the ledger", "/orders"],
    ["the queue", "/tickets"],
    ["the fleet", "/devices"],
  ] as const) {
    test(`${label} is axe-clean`, async ({ page }) => {
      await signIn(page, "admin", path);
      await expect(page.getByTestId("entity-total")).toBeVisible();
      // Animations settle first: a bar still growing has a different
      // computed colour from the one a reader ends up looking at.
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== "running"),
      );

      const audit = await new AxeBuilder({ page })
        .include("#nu-main")
        .exclude(".ant-table-measure-row")
        .analyze();
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
  }
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

/**
 * A list says how old it is, and the reader decides how often it is re-asked
 * (§53).
 *
 * The claim a component test cannot make: the refresh really goes back to the
 * database and the answer on screen is replaced by a *new* one — and that a
 * chosen interval outlives a reload, because it is the reader's habit rather
 * than a setting of the page's.
 */
/**
 * The ledger can be peeked at without being left (§64).
 *
 * A ledger is scanned — "which order is this refund about" — and the answer is
 * three fields, which is not worth losing a reader's place in forty thousand
 * rows for. The row still opens the record page, because an order somebody is
 * going to *work on* deserves the page. The peek is a URL, like the
 * explorer's, so it can be sent with the filters that found it.
 */
test("an order can be looked at without leaving the ledger, and the peek is a link", async ({
  page,
}) => {
  // `payment_status`, not `status`: PAID is how an order was paid for, and
  // its status is where it is in the pipeline (§7).
  await signIn(page, "manager", "/orders?f.payment_status=PAID");
  const row = page.locator(".ant-table-row").first();
  await expect(row).toBeVisible();

  // The reference comes off the peek control's own label rather than the
  // first cell — that one is the selection tick box.
  const peek = page.getByRole("button", { name: /^Preview ORD-/ }).first();
  const reference = ((await peek.getAttribute("aria-label")) ?? "").replace("Preview ", "");
  await peek.click();

  // The drawer, and the ledger still behind it with its filter intact.
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(reference);
  await expect(page.getByTestId("entity-total")).toBeVisible();
  await expect(page).toHaveURL(/f\.payment_status=PAID/);
  await expect(page).toHaveURL(/preview=/);

  // Deep-linked: the same address, opened cold, opens the same peek.
  const address = page.url();
  await page.goto("/home");
  await page.goto(address);
  await expect(page.getByRole("dialog")).toContainText(reference);

  // And Escape closes it, leaving the list — not the record page.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page).toHaveURL(/\/orders/);
});

test("a list refreshes on the reader's own schedule and says when it last did", async ({
  page,
}) => {
  await signIn(page, "manager", "/orders");
  await expect(page.getByTestId("entity-total")).toBeVisible();

  const age = page.getByTestId("refreshed-at");
  await expect(age).toContainText(/Refreshed|Refreshing/);

  // Counted at the network, so this is the request going out again rather
  // than a label being redrawn.
  let asked = 0;
  page.on("request", (request) => {
    if (request.url().includes("/explorer/query")) asked += 1;
  });

  await page.getByTestId("refresh-now").click();
  await expect.poll(() => asked, { timeout: 10_000 }).toBeGreaterThan(0);

  // The interval is chosen from the split control's menu, and remembered
  // across a reload — per dataset, so the ledger's habit is not the queue's.
  await page.locator(".nu-refresh").getByRole("button", { name: /down/ }).click();
  await page.getByRole("menuitem", { name: "Every 30s" }).click();
  await expect(page.getByTestId("refresh-now")).toContainText("30s");

  await page.reload();
  await expect(page.getByTestId("refresh-now")).toContainText("30s");
  await page.goto("/tickets");
  await expect(page.getByTestId("refresh-now")).toContainText("Refresh");

  // Put it back, so the rest of the suite reads a page nobody is polling.
  await page.goto("/orders");
  await page.locator(".nu-refresh").getByRole("button", { name: /down/ }).click();
  await page.getByRole("menuitem", { name: "Off" }).click();
  await expect(page.getByTestId("refresh-now")).toContainText("Refresh");
});
