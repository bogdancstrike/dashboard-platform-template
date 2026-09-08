import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { sweepAnnouncements, writeAnnouncement } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * The noticeboard against the real stack (§17, §34).
 *
 * The claims a component test cannot make: "live" is decided by PostgreSQL
 * from the window rather than by a status somebody swept, a notice addressed
 * to a role is invisible to everybody else *in SQL*, acknowledging survives a
 * reload because it is a row rather than a click, and writing one is a
 * privilege a viewer does not have.
 *
 * Every test cleans up after itself through the API: notices are rows every
 * other reader sees, and a suite that leaves five "E2E notice" entries behind
 * publishes them to the whole demo.
 */

const PREFIX = "E2E notice";

/**
 * A notice of this suite's own, published now — and remembered so it can be
 * withdrawn again.
 *
 * Remembered by *id*, not swept by title prefix: these tests run in parallel
 * and a prefix sweep deleted a sibling's notice mid-test.
 */
const written: string[] = [];

async function write(
  title: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const id = await writeAnnouncement({ title, ...overrides });
  written.push(id);
  return id;
}

test.afterEach(async () => {
  await sweepAnnouncements(written.splice(0, written.length));
});

test("live is decided by the window, not by a status somebody swept", async ({ page }) => {
  await signIn(page, "admin", "/announcements");
  await expect(page.getByTestId("announcement-board")).toBeVisible();

  const current = `${PREFIX} current ${Date.now()}`;
  const past = `${PREFIX} expired ${Date.now()}`;
  await write(current);
  await write(past, {
    publish_at: new Date(Date.now() - 90 * 86_400_000).toISOString(),
    expires_at: new Date(Date.now() - 86_400_000).toISOString(),
  });

  await page.reload();
  const board = page.getByTestId("announcement-board");
  await expect(board.getByText(current)).toBeVisible();
  // Both are stored as PUBLISHED. The difference is computed on every read.
  await expect(board.getByText(past)).toHaveCount(0);

  await page.getByTestId("announcement-history").click();
  await expect(page.getByTestId("announcement-board").getByText(past)).toBeVisible();
});

test("a notice addressed to a role is invisible to everybody else", async ({ page, browser }) => {
  await signIn(page, "admin", "/announcements");
  await expect(page.getByTestId("announcement-board")).toBeVisible();

  const title = `${PREFIX} managers ${Date.now()}`;
  await write(title, { audience_roles: ["MANAGER"] });

  const context = await browser.newContext({ storageState: storageStateFor("viewer") });
  const viewer = await context.newPage();
  try {
    await signIn(viewer, "viewer", "/announcements");
    await expect(viewer.getByTestId("announcement-board")).toBeVisible();
    // Filtered in SQL, not hidden in the browser: a page that downloaded it
    // and chose not to draw it has published it to anybody with a debugger.
    await expect(viewer.getByTestId("announcement-board").getByText(title)).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("acknowledging is a row, so it survives a reload", async ({ page }) => {
  await signIn(page, "admin", "/announcements");
  await expect(page.getByTestId("announcement-board")).toBeVisible();

  const title = `${PREFIX} policy ${Date.now()}`;
  await write(title, {
    severity: "CRITICAL",
    category: "POLICY",
    requires_acknowledgement: true,
  });

  await page.reload();
  const notice = page.locator(".nu-announce").filter({ hasText: title });
  await expect(notice).toBeVisible();
  await notice.getByTestId("acknowledge").click();
  await expect(notice.getByText("Acknowledged")).toBeVisible();

  await page.reload();
  const again = page.locator(".nu-announce").filter({ hasText: title });
  await expect(again.getByText("Acknowledged")).toBeVisible();
  await expect(again.getByTestId("acknowledge")).toHaveCount(0);
});

test("a viewer reads the board and is offered no way to write to it", async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStateFor("viewer") });
  const page = await context.newPage();
  try {
    await signIn(page, "viewer", "/announcements");
    await expect(page.getByTestId("announcement-board")).toBeVisible();
    // §76 applies to *features*, not to a broadcast: writing one is not a
    // thing a viewer's role does at all, so the control is absent rather than
    // shown disabled — and the authoring view with it.
    await expect(page.getByTestId("new-announcement")).toHaveCount(0);
    await expect(page.getByTestId("announcement-view")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("an author sees every state and how far each notice got", async ({ page }) => {
  await signIn(page, "admin", "/announcements?view=manage");

  const table = page.getByTestId("announcement-authoring");
  await expect(table).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Reach" })).toBeVisible();
  await expect(table.locator(".ant-table-row").first()).toBeVisible();
  await expect(table.getByText(/\d+ read/).first()).toBeVisible();
});

test("the board is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/announcements");
  await expect(page.getByTestId("announcement-board")).toBeVisible();

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
