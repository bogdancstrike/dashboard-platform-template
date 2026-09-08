import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { sweepMailThreads } from "./api";
import { signIn, storageStateFor } from "./auth";
import { openSelect } from "./query";

/**
 * The mailbox against the real stack (§14–§16).
 *
 * The claims a component test cannot make: that a mailbox is **one person's** —
 * asserted from a second account, which is the only way to test it; that a
 * draft saved here is still a draft after a reload; that sending moves it to
 * Outbox and it stops being editable; and that the unread count on the folder
 * rail is the *database's*, so it follows a thread being read.
 *
 * Serial, and each test writes its own mail: a suite that leaves conversations
 * behind fills the inbox a reviewer opens.
 */

test.describe.configure({ mode: "serial" });

const PREFIX = "E2E mail";

/** Threads this file made, binned and deleted however the test ended. */
const made: string[] = [];

test.afterEach(async () => {
  await sweepMailThreads(made.splice(0, made.length));
});

/**
 * A message of this test's own, through the composer — the only create path a
 * person has.
 */
async function compose(
  page: import("@playwright/test").Page,
  subject: string,
  { send = false }: { send?: boolean } = {},
): Promise<string> {
  await page.getByTestId("compose").click();
  const composer = page.getByTestId("composer");
  await expect(composer).toBeVisible();

  // The shared helper, because AntD puts the accessible name on both the
  // wrapper and the inner input and `getByLabel` matches twice.
  await openSelect(page, "To");
  await page.keyboard.type("somebody@example.com");
  await page.keyboard.press("Enter");
  await composer.getByLabel("Subject").fill(subject);
  await composer.getByLabel("Message").fill("Written by the end-to-end suite.");

  await page.getByTestId(send ? "send" : "save-draft").click();
  await expect(page.getByTestId("composer")).toHaveCount(0);

  // The page navigates to what was just written, in the folder it landed in —
  // read back from the address rather than from the form that wrote it.
  await expect(page).toHaveURL(/thread=[0-9a-f-]{36}/);
  const id = new URL(page.url()).searchParams.get("thread")!;
  made.push(id);
  return id;
}


/**
 * File a thread into a folder, and mark one unread.
 *
 * Through the product's own controls — the reader's Move menu and the list's
 * bulk bar — rather than through the API, because `e2e/api.ts` is for cleanup
 * and every claim in this suite is made where the product is.
 */
async function moveTo(
  page: import("@playwright/test").Page,
  folder: string,
): Promise<void> {
  // The thread already open in the reader — `compose` leaves it there, and
  // navigating to another folder first is what made the first version of this
  // helper look for a draft in the inbox.
  await expect(page.getByTestId("thread-reader")).toBeVisible();
  await page.getByTestId("move-thread").click();
  await page.getByRole("menuitem", { name: new RegExp(`Move to ${folder}`, "i") }).click();
}

async function markUnread(
  page: import("@playwright/test").Page,
  threadId: string,
): Promise<void> {
  await page.getByTestId(`thread-${threadId}`).getByRole("checkbox").check();
  const bar = page.getByTestId("bulk-bar");
  await expect(bar).toBeVisible();
  await bar.getByTestId("bulk-unread").click();
  await expect(bar).toHaveCount(0);
}

test("a draft is saved, lands in Drafts, and is still a draft after a reload", async ({
  page,
}) => {
  await signIn(page, "admin", "/mail");
  await expect(page.getByTestId("thread-list")).toBeVisible();

  const subject = `${PREFIX} draft ${Date.now()}`;
  await compose(page, subject);

  await expect(page).toHaveURL(/folder=DRAFTS/);
  const reader = page.getByTestId("thread-reader");
  await expect(reader.getByText(subject)).toBeVisible();
  await expect(reader.getByTestId("edit-draft")).toBeVisible();
  // A draft has no Reply: the control there is Edit.
  await expect(reader.getByTestId("reply")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("thread-reader").getByTestId("edit-draft")).toBeVisible();
});

test("sending moves a message to Outbox and it stops being editable", async ({ page }) => {
  await signIn(page, "admin", "/mail");
  await expect(page.getByTestId("thread-list")).toBeVisible();

  const subject = `${PREFIX} sent ${Date.now()}`;
  await compose(page, subject, { send: true });

  // OUTBOX and not SENT: nothing has transported it, and the folder is the
  // whole claim the row makes.
  await expect(page).toHaveURL(/folder=OUTBOX/);
  const reader = page.getByTestId("thread-reader");
  await expect(reader.getByText(/waiting for a transport/)).toBeVisible();
  await expect(reader.getByTestId("edit-draft")).toHaveCount(0);
  await expect(reader.getByTestId("reply")).toBeVisible();
});

test("a draft becomes a sent message, and the folders follow it", async ({ page }) => {
  await signIn(page, "admin", "/mail");
  await expect(page.getByTestId("thread-list")).toBeVisible();

  const subject = `${PREFIX} promote ${Date.now()}`;
  await compose(page, subject);

  await page.getByTestId("thread-reader").getByTestId("edit-draft").click();
  await expect(page.getByTestId("composer")).toBeVisible();
  await page.getByTestId("send").click();
  await expect(page.getByTestId("composer")).toHaveCount(0);

  await expect(page).toHaveURL(/folder=OUTBOX/);
  // And Drafts no longer holds it, because a draft that was sent is not a
  // draft — it is the same row, moved.
  await page.getByTestId("folder-DRAFTS").click();
  await expect(page.getByTestId("thread-list").getByText(subject)).toHaveCount(0);
});

test("the unread count on a folder is the database's, and follows a read", async ({
  page,
}) => {
  await signIn(page, "admin", "/mail");
  await expect(page.getByTestId("thread-list")).toBeVisible();

  // An unread conversation of this test's own. Depending on the seed's would
  // depend on the tests before it in this file, which mark things read — the
  // same shared-state trap the mail unit tests documented.
  const subject = `${PREFIX} unread ${Date.now()}`;
  const threadId = await compose(page, subject);
  // Moved while it is still open in the reader, then followed into the inbox.
  await moveTo(page, "Inbox");
  await page.getByTestId("folder-INBOX").click();
  await expect(page.getByTestId(`thread-${threadId}`)).toBeVisible();
  await markUnread(page, threadId);

  // Close it first. `moveTo` left it open in the reader, and re-opening a
  // thread that is already open is answered from the cache — no request, no
  // read-marking, and a count that never moves.
  await page.getByTestId("folder-INBOX").click();
  await expect(page.getByTestId("thread-reader")).toHaveCount(0);

  // Read from the folder button's own accessible name, which is what a screen
  // reader is given — so this asserts the thing a person actually gets rather
  // than a span the layout happens to render.
  const unread = async () => {
    const name = await page.getByTestId("folder-INBOX").getAttribute("aria-label");
    return Number(/(\d+) unread/.exec(name ?? "")?.[1] ?? 0);
  };
  const before = await unread();
  expect(before).toBeGreaterThan(0);

  await page.getByTestId(`open-${threadId}`).click();
  await expect(page.getByTestId("thread-reader")).toBeVisible();

  // Reading it is a write, so the count is a fact about rows and moves with it.
  await expect.poll(unread).toBe(before - 1);
});

test("a bulk action applies to what was chosen and says how many", async ({ page }) => {
  await signIn(page, "admin", "/mail");
  await expect(page.getByTestId("thread-list")).toBeVisible();

  const boxes = page.getByTestId("thread-list").getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(1).check();

  const bar = page.getByTestId("bulk-bar");
  await expect(bar).toBeVisible();
  await expect(bar.getByText("2 selected")).toBeVisible();

  await bar.getByTestId("bulk-read").click();
  // The count comes back from the server, so it is what actually changed.
  await expect(page.getByText(/2 conversations updated/)).toBeVisible();
});

test("a mailbox is one person's, asserted from another account", async ({
  page,
  browser,
}) => {
  await signIn(page, "admin", "/mail");
  await expect(page.getByTestId("thread-list")).toBeVisible();

  const subject = `${PREFIX} private ${Date.now()}`;
  const threadId = await compose(page, subject);

  const context = await browser.newContext({ storageState: storageStateFor("manager") });
  const colleague = await context.newPage();
  try {
    // Addressed directly, which is the only way to try: there is no link to
    // somebody else's conversation anywhere in the product.
    await signIn(colleague, "manager", `/mail?thread=${threadId}`);
    await expect(colleague.getByTestId("thread-list")).toBeVisible();
    // Not found rather than forbidden — saying "that exists but is not yours"
    // is itself the disclosure.
    await expect(colleague.getByText(/does not exist/)).toBeVisible();
    await expect(colleague.getByText(subject)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test.describe("what an analyst is offered", () => {
  test.use({ storageState: storageStateFor("analyst") });

  test("nothing — an analyst has no mailbox", async ({ page }) => {
    await signIn(page, "analyst", "/dashboard");
    await expect(page.getByRole("menuitem", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Mail" })).toHaveCount(0);
  });
});

test("the mailbox is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/mail");
  await expect(page.getByTestId("thread-list")).toBeVisible();

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
