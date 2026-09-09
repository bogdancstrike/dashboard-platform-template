import { expect, test, type Page } from "@playwright/test";

import { sweepAnnouncements, writeAnnouncement } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * The shell's own band, against the real stack (§17).
 *
 * The claim only a browser can make: a notice published while somebody is
 * using the platform reaches them *without* their opening a page to look for
 * it — and dismissing it writes a receipt, so it is gone on the next sign-in
 * rather than only in this tab.
 *
 * Written through the API, because these tests are about what the *reader*
 * sees: driving the author's drawer first would make each of them a test of
 * the drawer as well, and a failure there would read as a failure of the band.
 */

/**
 * Serial, because they all write to *one band*.
 *
 * Two tests publishing a pinned critical notice at the same moment are two
 * notices of equal rank, and each test then finds the other's on screen — a
 * failure that reads exactly like "the band shows the wrong notice" and is
 * nothing of the kind. The board itself is shared state, like the kanban lanes
 * `records-write.spec` serialises for the same reason.
 */
test.describe.configure({ mode: "serial" });

const created: string[] = [];

test.afterEach(async () => {
  await sweepAnnouncements(created.splice(0, created.length), "manager");
});

/**
 * Publish a notice from inside a signed-in test, and show it to the reader.
 *
 * Signed in *first*, deliberately: `writeAnnouncement` reuses the token the
 * browser is already carrying, and asking Keycloak for a direct grant instead
 * is what trips the realm's brute-force protection after a few specs have
 * done it — the failure then lands as "Keycloak refused the direct grant" in
 * whichever test ran next.
 */
async function publish(page: Page, notice: Record<string, unknown>): Promise<void> {
  created.push(await writeAnnouncement(notice, "manager"));
  await page.reload();
  await expect(page.locator("#nu-main")).toBeVisible();
}

/** This notice, on the band — whether or not the band is showing another. */
function bandFor(page: Page, title: string) {
  return page.getByTestId("announcement-banner").filter({ hasText: title });
}

test.describe("the announcement band", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("a notice reaches a reader who never opened the noticeboard", async ({ page }) => {
    const title = `E2E band warning ${Date.now().toString(36)}`;
    await signIn(page, "manager", "/dashboard");

    // Pinned *and* critical, so it is the one on screen: the demo dataset
    // carries a pinned maintenance warning of its own, and one band at a time
    // is the rule under test. Outranking it is how a test says "mine".
    await publish(page, {
      title,
      severity: "CRITICAL",
      category: "MAINTENANCE",
      is_pinned: true,
    });

    // Still on the dashboard: the notice came to the reader.
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(bandFor(page, title)).toBeVisible();
  });

  test("dismissing it writes a receipt, so it stays gone", async ({ page }) => {
    const title = `E2E band dismiss ${Date.now().toString(36)}`;
    await signIn(page, "manager", "/dashboard");
    await publish(page, { title, severity: "CRITICAL", is_pinned: true });
    await expect(bandFor(page, title)).toBeVisible();

    await page.getByTestId("announcement-dismiss").click();
    // The band itself may stay — the demo has other live notices, and the next
    // one takes the place of the one just read. What must be gone is *this*
    // notice.
    await expect(bandFor(page, title)).toHaveCount(0);

    // The receipt is the server's, not this tab's.
    await page.reload();
    await expect(page.locator("#nu-main")).toBeVisible();
    await expect(bandFor(page, title)).toHaveCount(0);
    // And it is still readable where notices live.
    await page.goto("/announcements");
    await expect(page.locator("#nu-main")).toContainText(title);
  });

  test("a notice that requires agreement cannot be dismissed", async ({ page }) => {
    const title = `E2E band agree ${Date.now().toString(36)}`;
    await signIn(page, "manager", "/dashboard");
    await publish(page, {
      title,
      severity: "CRITICAL",
      category: "POLICY",
      requires_acknowledgement: true,
    });
    await expect(bandFor(page, title)).toBeVisible();

    // No way past it but through it.
    await expect(page.getByTestId("announcement-dismiss")).toHaveCount(0);
    await page.getByTestId("announcement-acknowledge").click();
    await expect(page.getByText("Acknowledged")).toBeVisible();
    await expect(bandFor(page, title)).toHaveCount(0);
  });

  test("a release note does not interrupt", async ({ page }) => {
    const title = `E2E band news ${Date.now().toString(36)}`;
    await signIn(page, "manager", "/dashboard");
    await publish(page, { title, severity: "INFO", category: "RELEASE" });

    // A shell that announced everything is a shell people learn to skip, and
    // then the maintenance notice is skipped too. It is on the page instead.
    await expect(bandFor(page, title)).toHaveCount(0);
    await page.goto("/announcements");
    await expect(page.locator("#nu-main")).toContainText(title);
  });
});
