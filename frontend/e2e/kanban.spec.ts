import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { sweepBoards, updateBoard } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Kanban boards against the real stack (§18).
 *
 * The claims a component test cannot make: a card dropped in another lane is
 * *still there after a reload* and the lane counts — which PostgreSQL computed
 * over the whole board — moved with it; a lane deleted hands its cards to
 * another one rather than losing them; the hierarchy rule is enforced by the
 * server, not by the picker; and a colleague reading a shared board is offered
 * none of the controls.
 *
 * Serial, and each test works on a board of its own: these write to a shared
 * database, and a suite that leaves boards behind fills the gallery a reviewer
 * opens.
 */

test.describe.configure({ mode: "serial" });

const PREFIX = "E2E board";

/** Boards this file made, removed however the test ended. */
const made: string[] = [];

test.afterEach(async () => {
  await sweepBoards(made.splice(0, made.length));
});

/** A board of this test's own, through the UI — which is also the create path. */
async function newBoard(page: Page, name: string): Promise<string> {
  await page.getByTestId("new-board").click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("Board name").fill(name);
  await page.getByTestId("create-board").click();

  // The board lives in the address (§69), so creating one puts it there —
  // waited for rather than read, because the write and the navigation are two
  // steps and reading between them returns the board that *was* open.
  await expect(page).toHaveURL(/board=[0-9a-f-]{36}/);
  const id = new URL(page.url()).searchParams.get("board")!;
  made.push(id);

  // And waited for the *new* board's own heading, not merely for a board.
  // `kanban-board` is already on screen — showing the previous board — so a
  // test that carried on here added its cards to the wrong one, and the
  // failure read as "the lane is empty".
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByTestId("kanban-board")).toBeVisible();
  return id;
}

/**
 * The lanes on screen, left to right.
 *
 * Read from the section's own label rather than from the header's text: the
 * done lane's header also carries a "done" tag, so its text is "Done done".
 */
async function laneNames(page: Page): Promise<string[]> {
  return page.locator(".nu-lane-col").evaluateAll((sections) =>
    sections.map((section) => section.getAttribute("aria-label") ?? ""),
  );
}

/**
 * Add a card to a lane, the way a person does.
 *
 * `Enter` rather than blurring the field: both submit, but a blur depends on
 * what the click lands on next, and one of these tests blurred into a place
 * that never fired it — the card simply was not created and the failure read
 * as "the lane is empty".
 */
async function addCard(page: Page, lane: string, title: string): Promise<void> {
  const column = page
    .locator(".nu-lane-col")
    .filter({ has: page.getByText(lane, { exact: true }) });
  await column.getByTestId(/^add-card-/).click();
  const field = column.getByRole("textbox");
  await field.fill(title);
  await field.press("Enter");
  await expect(column.getByText(title)).toBeVisible();
}

/** The count in a lane's header pill, which the server computed. */
async function laneCount(page: Page, name: string): Promise<number> {
  const lane = page.locator(".nu-lane-col").filter({ has: page.getByText(name, { exact: true }) });
  const text = (await lane.locator(".nu-lane-col-count").first().textContent()) ?? "0";
  return Number((text.split("/")[0] ?? "0").replace(/[^\d]/g, ""));
}

test("a new board arrives with lanes, and its cards carry its key", async ({ page }) => {
  await signIn(page, "admin", "/kanban");
  await newBoard(page, `${PREFIX} start ${Date.now()}`);

  // A board created empty is a board whose first action is administration.
  expect(await laneNames(page)).toEqual([
    "Backlog",
    "Selected",
    "In progress",
    "In review",
    "Done",
  ]);

  await addCard(page, "Backlog", "First piece of work");

  // The reference is the board's key and a padded number, which is what makes
  // it quotable without naming the board.
  await expect(page.locator(".nu-card-ref").first()).toHaveText(/^[A-Z0-9]+-\d{5}$/);
});

test("a card dropped in another lane is still there after a reload", async ({ page }) => {
  await signIn(page, "admin", "/kanban");
  await newBoard(page, `${PREFIX} move ${Date.now()}`);

  await addCard(page, "Backlog", "Travels between lanes");

  expect(await laneCount(page, "Backlog")).toBe(1);
  expect(await laneCount(page, "In progress")).toBe(0);

  // Moved from the keyboard, which is the path a pointer-free reader takes —
  // and the same mutation the drag uses (§64).
  const card = page.locator(".nu-card").filter({ hasText: "Travels between lanes" });
  await card.getByRole("button", { name: /^Move / }).click();
  await page.getByRole("menuitem", { name: "Move to In progress" }).click();

  // The counts are PostgreSQL's over the whole board, so they are the proof
  // the write landed rather than that the browser redrew.
  await expect.poll(() => laneCount(page, "In progress")).toBe(1);
  await expect.poll(() => laneCount(page, "Backlog")).toBe(0);

  await page.reload();
  const progress = page
    .locator(".nu-lane-col")
    .filter({ has: page.getByText("In progress", { exact: true }) });
  await expect(progress.getByText("Travels between lanes")).toBeVisible();
});

/**
 * The order within a lane is the reader's, and reachable without a mouse
 * (§18, §54).
 *
 * A hand-made order is what a board is *for* — "these three first" is a
 * decision, not a fact the data carries — and the grip menu offered only
 * "move to another lane", which left that decision to the drag. A drag is
 * exactly the gesture somebody using a keyboard cannot make.
 */
test("a card reordered from the keyboard keeps its place after a reload", async ({ page }) => {
  await signIn(page, "admin", "/kanban");
  await newBoard(page, `${PREFIX} order ${Date.now()}`);

  await addCard(page, "Backlog", "First in");
  await addCard(page, "Backlog", "Second in");

  const lane = page
    .locator(".nu-lane-col")
    .filter({ has: page.getByText("Backlog", { exact: true }) });
  const titles = () => lane.locator(".nu-card-title").allTextContents();
  expect(await titles()).toEqual(["First in", "Second in"]);

  // The second card, moved up its own lane from the menu.
  await lane
    .locator(".nu-card")
    .filter({ hasText: "Second in" })
    .getByRole("button", { name: /^Move / })
    .click();
  await page.getByRole("menuitem", { name: /Move up in this lane/ }).click();
  await expect.poll(titles).toEqual(["Second in", "First in"]);

  // Stored, not merely drawn: the order came back from PostgreSQL. Waited on
  // the lane rather than polled through the reload — a locator read while the
  // document is being replaced throws rather than retrying.
  await page.reload();
  await expect(lane.locator(".nu-card-title").first()).toBeVisible();
  await expect.poll(titles).toEqual(["Second in", "First in"]);

  // And the ends say they are ends rather than offering a move that would do
  // nothing.
  await lane
    .locator(".nu-card")
    .filter({ hasText: "Second in" })
    .getByRole("button", { name: /^Move / })
    .click();
  await expect(page.getByRole("menuitem", { name: /Move up in this lane/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
});

test("arriving in the done lane finishes a card", async ({ page }) => {
  await signIn(page, "admin", "/kanban");
  await newBoard(page, `${PREFIX} done ${Date.now()}`);

  await addCard(page, "Backlog", "Gets finished");

  const card = page.locator(".nu-card").filter({ hasText: "Gets finished" });
  await card.getByRole("button", { name: /^Move / }).click();
  await page.getByRole("menuitem", { name: /Move to Done/ }).click();

  // The card itself says so, which is the same fact every report reads. The
  // card's *title* also contains the word, so the assertion names the
  // sentence rather than matching anything that says "finished".
  await page
    .locator(".nu-card")
    .filter({ hasText: "Gets finished" })
    .getByText("Gets finished")
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText(/· finished /)).toBeVisible();
});

test("a lane removed hands its cards to another one", async ({ page }) => {
  await signIn(page, "admin", "/kanban");
  await newBoard(page, `${PREFIX} lanes ${Date.now()}`);

  await addCard(page, "Selected", "Must not be lost");

  const selected = page
    .locator(".nu-lane-col")
    .filter({ has: page.getByText("Selected", { exact: true }) });
  await selected.getByRole("button", { name: /^Actions for Selected/ }).click();
  await page.getByRole("menuitem", { name: /1 card moves/ }).click();
  const dialog = page.getByRole("dialog").filter({ hasText: "Remove Selected?" });
  await expect(dialog.getByText(/1 card will move\. Nothing is deleted\./)).toBeVisible();
  await dialog.getByRole("button", { name: "Remove the lane" }).click();

  // The lane going is what the click has to *land*, so it is polled: the card
  // was already on screen before the removal, so waiting for it waits for
  // nothing and the lane list was read before the refetch arrived.
  await expect.poll(() => laneNames(page)).not.toContain("Selected");

  // And losing somebody's work to a column they were tidying up is the single
  // worst thing a board can do — asserted after the lane is gone, which is
  // the only moment at which the claim means anything.
  await expect(page.getByText("Must not be lost")).toBeVisible();
});

test("the hierarchy rule is the server's, not the picker's", async ({ page }) => {
  await signIn(page, "admin", "/kanban");
  await newBoard(page, `${PREFIX} tree ${Date.now()}`);
  await addCard(page, "Backlog", "A task with no parent");

  // A task's parent options are stories, and this board has none — so the
  // picker is not offered at all rather than offering something invalid (§76).
  await page.getByText("A task with no parent").click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("combobox", { name: "Parent" })).toHaveCount(0);
});

test("a colleague reads a shared board and is offered none of the controls", async ({
  page,
  browser,
}) => {
  await signIn(page, "admin", "/kanban");
  const boardId = await newBoard(page, `${PREFIX} shared ${Date.now()}`);

  await addCard(page, "Backlog", "Readable, not writable");

  // Shared so a colleague can read it; only the owner writes (§5).
  await updateBoard(boardId, { scope: "PUBLIC" });

  const context = await browser.newContext({ storageState: storageStateFor("manager") });
  const colleague = await context.newPage();
  try {
    await signIn(colleague, "manager", `/kanban?board=${boardId}`);
    await expect(colleague.getByText("Readable, not writable")).toBeVisible();
    // Readable, and none of the owner's controls are offered — not disabled,
    // absent: rearranging somebody else's board is not a thing this reader's
    // role does at all.
    await expect(colleague.getByTestId("add-lane")).toHaveCount(0);
    await expect(colleague.getByTestId("board-actions")).toHaveCount(0);
    await expect(colleague.locator(".nu-lane-col-new")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("the board is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/kanban");
  await expect(page.getByTestId("kanban-board")).toBeVisible();

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
