import { expect, test, type Page } from "@playwright/test";

import { restoreTaskStatus } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Writing a record through the real stack (§9, §18, §73).
 *
 * The two assertions worth making about a board are the ones a component test
 * cannot: that a card dropped in another lane is *still there after a reload*,
 * and that the lane counts — which the database computes over the whole
 * dataset, not the page on screen — moved with it.
 *
 * Every test puts the record back where it found it. The seeded dataset is
 * what the rest of the suite measures against, and a run that leaves one more
 * task in "In review" each time is a run that eventually breaks a test nobody
 * connects to this file.
 *
 * Serial, and not because the tests are slow. They all write to one board, and
 * a lane count read while another worker is moving a card into that lane is a
 * flake that reads exactly like a product bug. The task *work* page lives here
 * for the same reason: it creates and deletes tasks, which moves the very
 * counts the board tests measure.
 */

test.describe.configure({ mode: "serial" });

/**
 * Where each card was before this file moved it.
 *
 * Restored unconditionally, because putting it back at the end of the happy
 * path is not putting it back: a run that failed in between left the task in
 * the lane it had been dragged to, and `NEW` lost one task per failed run
 * until it held none — after which every run failed for want of a card to
 * drag, taking another one with it.
 */
const moved: { reference: string; from: string }[] = [];

test.afterEach(async () => {
  for (const card of moved.splice(0, moved.length)) {
    await restoreTaskStatus(card.reference, card.from);
  }
});

/** The number in a lane's header pill, which the server counted. */
async function laneCount(page: Page, status: string): Promise<number> {
  const text = (await page.getByTestId(`lane-${status}`).locator(".nu-lane-count").textContent()) ?? "0";
  return Number(text.replace(/[^\d]/g, ""));
}

/**
 * Wait for the board to have its counts before measuring anything.
 *
 * The lanes render as soon as the vocabulary is known, and their pills fill in
 * when the per-lane queries answer. Reading a baseline in that gap gives zero,
 * and every later assertion is then measured against a number that was never
 * true — which failed as "the write did not reach the database".
 */
async function settledBoard(page: Page, status: string): Promise<number> {
  await expect(page.getByTestId("task-board")).toBeVisible();
  await expect
    .poll(() => laneCount(page, status), { timeout: 15_000 })
    .toBeGreaterThan(0);
  return laneCount(page, status);
}

/** Move the first card of a lane, by the keyboard path a pointer-free reader uses. */
async function moveFirstCard(page: Page, from: string, to: string): Promise<string> {
  const card = page.getByTestId(`lane-${from}`).locator(".nu-task-card").first();
  const reference = ((await card.locator(".nu-task-ref").textContent()) ?? "").trim();
  // Recorded *before* the move, so the `afterEach` can put it back whatever
  // happens between here and the end of the test.
  moved.push({ reference, from });
  await card.getByRole("button", { name: /^Move / }).click();
  await page.getByRole("menuitem", { name: to.replace(/_/g, " ") }).click();
  return reference;
}

test.describe("the task board writes to the record", () => {
  test("a card moved between lanes is still there after a reload", async ({ page }) => {
    await signIn(page, "admin", "/tasks");

    const fromBefore = await settledBoard(page, "IN_PROGRESS");
    const toBefore = await laneCount(page, "IN_REVIEW");
    const reference = await moveFirstCard(page, "IN_PROGRESS", "IN_REVIEW");

    // The counts are aggregates over the whole dataset, so they are the proof
    // the write reached the database rather than only the browser.
    //
    // Directional rather than exact. The database is shared with every other
    // spec in the suite, and one of them creating a task between the two reads
    // moves the number by more than this test did — which is a flake that
    // reads exactly like a lost write. What only *this* test can cause is the
    // change of direction, and that is what an optimistic-only update would
    // fail to produce.
    await expect
      .poll(() => laneCount(page, "IN_REVIEW"), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(toBefore + 1);
    await expect
      .poll(() => laneCount(page, "IN_PROGRESS"))
      .toBeLessThanOrEqual(fromBefore - 1);

    await page.reload();
    await expect(page.getByTestId("lane-IN_REVIEW").getByText(reference)).toBeVisible();

    // Put it back, so the next run measures the dataset this one started from.
    const card = page.getByTestId("lane-IN_REVIEW").locator(".nu-task-card")
      .filter({ hasText: reference });
    await card.getByRole("button", { name: /^Move / }).click();
    await page.getByRole("menuitem", { name: "IN PROGRESS" }).click();
    await expect(page.getByTestId("lane-IN_PROGRESS").getByText(reference)).toBeVisible();
  });

  test("the move is on the record's own history, as a status change", async ({ page }) => {
    await signIn(page, "admin", "/tasks");
    await expect(page.getByTestId("task-board")).toBeVisible();

    const reference = await moveFirstCard(page, "NEW", "ASSIGNED");
    await expect.poll(() => laneCount(page, "ASSIGNED"), { timeout: 15_000 }).toBeGreaterThan(0);

    // Settled before clicking. The lane re-sorts by priority every time its
    // query answers, and a keyed list that reorders *moves the DOM node* — so
    // a click that arrives mid-reorder reports "element was detached from the
    // DOM, retrying" and, under load, can keep missing until the test times
    // out. Waiting for the requests to stop is waiting for the list to hold
    // still, which is what a person does without thinking about it.
    await page.waitForLoadState("networkidle");
    const card = page.getByTestId("lane-ASSIGNED").locator(".nu-task-card")
      .filter({ hasText: reference });
    await card.getByText(reference).click();

    // The task page carries its history as a section rather than a tab — it
    // is a work page, and what happened to the record is part of the work.
    // The ledger says what moved and to what, not merely that something did.
    await expect(page.getByTestId("task-checklist")).toBeVisible();
    await expect(page.locator("#nu-main")).toContainText("History");
    await expect(page.locator("#nu-main")).toContainText("ASSIGNED");

    await page.goBack();
    const back = page.getByTestId("lane-ASSIGNED").locator(".nu-task-card")
      .filter({ hasText: reference });
    await back.getByRole("button", { name: /^Move / }).click();
    await page.getByRole("menuitem", { name: "NEW" }).click();
    await expect.poll(() => laneCount(page, "NEW"), { timeout: 15_000 }).toBeGreaterThan(0);
  });
});

/** Edit the open record's priority through the declared form. */
async function setPriority(page: Page, priority: string): Promise<void> {
  await page.getByTestId("record-edit").click();
  const drawer = page.getByRole("dialog");
  // The selector, not the search input inside it: with a value already chosen
  // the rendered label sits on top of the input and swallows the click.
  await drawer.locator(".ant-form-item").filter({ hasText: "Priority" })
    .locator(".ant-select-selector").click();
  // The dropdown option, not the closed select's own label: AntD gives both the
  // same `title`, so this matches twice as soon as the value being chosen is
  // already the current one — which is the state a re-run leaves behind.
  await page.locator(".ant-select-item-option").filter({ hasText: priority }).first().click();
  await drawer.getByTestId("record-form-save").click();
  await expect(drawer).toBeHidden();
}

test.describe("editing a record", () => {
  test("an edit saves what changed and the record shows it", async ({ page }) => {
    await signIn(page, "admin", "/tasks");
    await expect(page.getByTestId("task-board")).toBeVisible();

    // Open a task from the board, noting the priority the seed gave it so the
    // test can put it back.
    const card = page.getByTestId("lane-NEW").locator(".nu-task-card").first();
    const reference = ((await card.locator(".nu-task-ref").textContent()) ?? "").trim();
    const before = ((await card.locator(".ant-tag").first().textContent()) ?? "").trim();
    const target = before === "CRITICAL" ? "LOW" : "CRITICAL";
    await card.getByText(reference).click();
    await expect(page.getByTestId("record-edit")).toBeEnabled();

    await setPriority(page, target);
    // Read back from the record the server returned, not from the form that
    // sent it.
    await expect(page.locator("#nu-main")).toContainText(target);

    await setPriority(page, before);
    await expect(page.locator("#nu-main")).toContainText(before);
  });

  test("a reader who may not write sees the controls disabled, with the reason", async ({ browser }) => {
    // An analyst's own session, not the admin one the project replays.
    const context = await browser.newContext({ storageState: storageStateFor("analyst") });
    const page = await context.newPage();
    await signIn(page, "analyst", "/tasks");
    await expect(page.getByTestId("task-board")).toBeVisible();

    // §76: shown and disabled, never hidden — an analyst reads and exports,
    // and has to be able to see that editing exists and is not theirs.
    await expect(page.getByRole("button", { name: /New task/ })).toBeDisabled();
    await expect(page.getByText("This board is read-only for you")).toBeVisible();
    await context.close();
  });
});

/**
 * Create a task of this suite's own and open it.
 *
 * Not "the first card on the board": the board spec moves that one between
 * lanes at the same time, and two specs editing one row produce failures that
 * look like product bugs. Creating one also exercises the path a reader takes
 * to get here.
 */
async function openScratchTask(page: Page, title: string): Promise<void> {
  await signIn(page, "admin", "/tasks");
  await page.getByRole("button", { name: /New task/ }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("Title").fill(title);
  await drawer.getByTestId("record-form-save").click();
  await expect(page.getByTestId("task-checklist")).toBeVisible();
}

/** Remove it again, so the seeded dataset ends where it started. */
async function deleteTask(page: Page, title: string): Promise<void> {
  // Close whatever layer is open first — `Esc` closes the topmost one (§54),
  // and an open profile menu covers the header actions underneath it.
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Delete/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("task-board")).toBeVisible();
  await expect(page.getByText(title)).toHaveCount(0);
}

test("a comment is stored, and another person sees it", async ({ page, browser }) => {
  const title = `Playwright comment task ${Date.now()}`;
  const body = `Playwright note ${Date.now()}`;
  await openScratchTask(page, title);
  const address = page.url();

  const thread = page.getByTestId("comment-thread");
  await thread.getByLabel("Add a comment").fill(body);
  await thread.getByTestId("post-comment").click();
  await expect(thread.getByText(body)).toBeVisible();

  // A second reader, in their own session: a comment stored only in this
  // browser would be invisible here.
  const other = await browser.newContext({ storageState: storageStateFor("manager") });
  const otherPage = await other.newPage();
  try {
    await signIn(otherPage, "manager", new URL(address).pathname);
    await expect(otherPage.getByTestId("comment-thread").getByText(body)).toBeVisible();
  } finally {
    await other.close();
  }

  await deleteTask(page, title);
});

test("a ticked to-do is an edit to the record and survives a reload", async ({ page }) => {
  const title = `Playwright checklist task ${Date.now()}`;
  await openScratchTask(page, title);
  const checklist = page.getByTestId("task-checklist");
  const step = "Verify the counts";

  await checklist.getByLabel("New checklist item").fill(step);
  await checklist.getByRole("button", { name: /Add/ }).click();
  const item = checklist.getByRole("checkbox", { name: step });
  await expect(item).toBeVisible();

  // Clicked rather than `check()`ed: the box is controlled by the record, so
  // it only ticks once the write has come back — and `check()` asserts the
  // state change synchronously.
  await item.click();
  await expect(item).toBeChecked();
  await page.reload();

  // Still ticked, because it was written to the task rather than held on the
  // page — and the record's own history says so.
  await expect(page.getByTestId("task-checklist").getByRole("checkbox", { name: step })).toBeChecked();
  await expect(page.locator("#nu-main")).toContainText("History");

  await deleteTask(page, title);
});

test("a reader who may not comment is told, not handed a box that fails", async ({ page, browser }) => {
  const title = `Playwright permission task ${Date.now()}`;
  await openScratchTask(page, title);
  const address = new URL(page.url()).pathname;

  const context = await browser.newContext({ storageState: storageStateFor("analyst") });
  const analyst = await context.newPage();
  try {
    await signIn(analyst, "analyst", address);
    // An analyst reads everything and writes nothing — the page says which
    // permission that is, rather than failing after somebody has typed (§76).
    await expect(
      analyst.getByText("You can read this conversation but not add to it"),
    ).toBeVisible();
    await expect(analyst.getByTestId("post-comment")).toHaveCount(0);
  } finally {
    await context.close();
  }

  await deleteTask(page, title);
});
