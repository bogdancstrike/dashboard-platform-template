import { expect, test, type Page } from "@playwright/test";

import { restoreTaskStatus } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Writing a record through the real stack (§9, §18, §73).
 *
 * The assertion worth making about a board is the one a component test cannot:
 * that a card dropped in another lane is *still there after a reload*, when
 * every lane has refetched from the database and an optimistic-only update
 * would have been undone.
 *
 * Not the lane counts. They look like the stronger witness — the server
 * computes them over the whole dataset — and they are the weaker one: the
 * dataset is shared with every other spec, the specs run in parallel, and a
 * concurrent move out of the lane this test moved a card into leaves the count
 * exactly where it started. That reads as a lost write and is not one.
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

    await settledBoard(page, "IN_PROGRESS");
    const reference = await moveFirstCard(page, "IN_PROGRESS", "IN_REVIEW");

    // The card moved on screen…
    await expect(page.getByTestId("lane-IN_REVIEW").getByText(reference)).toBeVisible();
    await expect(page.getByTestId("lane-IN_PROGRESS").getByText(reference)).toHaveCount(0);

    // …and is still in the new lane after a reload, which is the assertion
    // that separates a write from an optimistic update: every lane refetches
    // from the database, so a card only the browser had moved goes back.
    //
    // The lane *counts* used to carry this, and they were the wrong witness.
    // They are aggregates over a dataset shared with every other spec, and
    // the specs run in parallel — so a concurrent move out of the target lane
    // cancels this test's move in, and the count is unchanged. It failed
    // exactly that way: expected 11, got 10, with nothing wrong. Directional
    // assertions did not save it, because the interference is directional too.
    // The card's own identity in the lane it was moved to is a fact about this
    // test alone.
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
  // Dismiss anything still hanging over the page first. An AntD dropdown is
  // rendered at the body root and outlives the element that opened it, so a
  // menu from a step or a test before this one sits above the Edit button —
  // and `toBeEnabled()` on the button is satisfied while the overlay is still
  // eating the click. Playwright then retries for the full minute and reports
  // "Edit was never clickable", which reads as a product bug and is not one.
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-dropdown:not(.ant-dropdown-hidden)")).toHaveCount(0);

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

test.describe("leaving a form with unsaved changes (§74)", () => {
  test("asks before discarding, and keeps the edit when told to", async ({ page }) => {
    await signIn(page, "admin", "/tickets");
    await expect(page.locator("tr.ant-table-row").first()).toBeVisible();

    // A ticket, opened for editing from the row's own actions menu — the menu
    // is portalled to the body, so the item is not inside the row.
    await page.locator("tr.ant-table-row").first()
      .getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const drawer = page.getByRole("dialog");
    const subject = drawer.getByLabel("Subject");
    const original = (await subject.inputValue()).trim();
    await subject.fill(`${original} — edited but not saved`);

    // Closing is a decision, not an accident.
    await drawer.locator(".ant-drawer-close").click();
    const guard = page.locator(".ant-modal-confirm");
    await expect(guard).toContainText("Discard your changes?");

    // "Keep editing" leaves the drawer open with the edit intact — a guard
    // that discarded on either button would be worse than none.
    await guard.getByRole("button", { name: "Keep editing" }).click();
    await expect(guard).toBeHidden();
    await expect(subject).toHaveValue(`${original} — edited but not saved`);

    // And discarding closes it without writing: the queue still shows the
    // subject the server has.
    await drawer.locator(".ant-drawer-close").click();
    await page.locator(".ant-modal-confirm").getByRole("button", { name: "Discard" }).click();
    await expect(drawer).toBeHidden();
    await page.reload();
    await expect(page.locator("tr.ant-table-row").first()).toContainText(original);
  });

  test("closes without asking when nothing was typed", async ({ page }) => {
    await signIn(page, "admin", "/tickets");
    await expect(page.locator("tr.ant-table-row").first()).toBeVisible();
    await page.locator("tr.ant-table-row").first()
      .getByRole("button", { name: /^Actions for/ }).click();
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();

    await drawer.locator(".ant-drawer-close").click();

    // A guard on every close teaches people to dismiss guards.
    await expect(page.locator(".ant-modal-confirm")).toHaveCount(0);
    await expect(drawer).toBeHidden();
  });
});

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

/**
 * The conversation is polymorphic, and the generic record page carries it
 * (§36).
 *
 * The task page puts the thread on the page because answering is the job; an
 * account puts it behind a tab because a comment there is occasional. Both are
 * the same endpoint and the same component, and this is the claim a component
 * test cannot make: a comment written on a *customer* — a dataset with no
 * bespoke page — is stored by the real API and is there after a reload.
 */
test("a comment on an account is stored, from the tab the generic page puts it in", async ({
  page,
}) => {
  const body = `Playwright account note ${Date.now()}`;
  await signIn(page, "manager", "/customers");
  await page.locator(".nu-account").first().click();
  await page.waitForURL(/\/customers\/[0-9a-f-]{36}/);

  await page.getByRole("tab", { name: "Conversation" }).click();
  const thread = page.getByTestId("comment-thread");
  await thread.getByLabel("Add a comment").fill(body);
  await thread.getByTestId("post-comment").click();
  await expect(thread.getByText(body)).toBeVisible();

  // Stored, not remembered: the tab is re-opened after a reload and the
  // comment came back from the database.
  await page.reload();
  await page.getByRole("tab", { name: "Conversation" }).click();
  await expect(page.getByTestId("comment-thread").getByText(body)).toBeVisible();

  // And the connections tab reads the record's own foreign keys (§50).
  await page.getByRole("tab", { name: "Connections" }).click();
  const connections = page.getByRole("tabpanel");
  // A group per foreign key the schema declares — "Account manager · 1",
  // "Tickets · as customer · 3" — or the honest empty state for a record that
  // is joined to nothing.
  await expect(
    connections
      .getByRole("heading", { level: 3 })
      .or(connections.getByText("No related records"))
      .first(),
  ).toBeVisible();

  // Put it back: the seeded dataset is what the rest of the suite measures.
  await page.getByRole("tab", { name: "Conversation" }).click();
  const mine = page
    .getByTestId("comment-thread")
    .locator(".nu-comment")
    .filter({ hasText: body })
    .first();
  // Withdrawn straight away: the thread's Delete is the author's own and asks
  // nothing, because a comment is a sentence rather than a record.
  await mine.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByTestId("comment-thread").getByText(body)).toHaveCount(0);
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
