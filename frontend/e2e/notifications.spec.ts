import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The notification centre (§17) against the real stack.
 *
 * The one thing only this level can prove is the **live channel**. A WebSocket
 * has to survive gunicorn's gevent worker, nginx's `Upgrade` forwarding and a
 * token that arrives in a subprotocol header rather than an `Authorization`
 * one. Every part of that is invisible to a component test, and the failure
 * mode is silent: the client falls back to polling and the page still works,
 * just a great deal less live than it claims. So the page states which it is,
 * and this asserts it.
 *
 * The mutating tests are written to be repeatable. `mark read` is followed by
 * `mark unread` so the demo database ends where it started, because a suite
 * that only passes the first time after a reseed is a suite people stop
 * running.
 */

function centre(page: Page) {
  return page.getByRole("list", { name: "Notifications" });
}

test.describe("notification centre", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/notifications"));

  test("lists the signed-in user's own notifications", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(centre(page).getByRole("listitem").first()).toBeVisible();
    await expect(page.getByTestId("unread-count")).toContainText("unread");
  });

  test("the live channel is connected through nginx, not falling back to polling", async ({
    page,
  }) => {
    // If this reads "Polling", the socket never opened: the proxy dropped the
    // upgrade, the token was refused, or flask-sock is not mounted.
    await expect(page.getByTestId("live-status")).toHaveText("Live");
  });

  test("filtering asks the server and round-trips through the URL", async ({ page }) => {
    await page.getByText("Unread", { exact: true }).click();

    await expect(page).toHaveURL(/read=unread/);
    const rows = centre(page).getByRole("listitem");
    await expect(rows.first()).toBeVisible();

    // Every row on screen is unread, which is only true if the server filtered.
    const readActions = await page.getByRole("button", { name: /as unread$/ }).count();
    expect(readActions).toBe(0);
  });

  test("a filtered centre survives being pasted as a link (§69)", async ({ page }) => {
    await page.goto("/notifications?read=read&category=SECURITY");

    // Exact, because "Read" is a substring of "Unread".
    await expect(page.getByRole("radio", { name: "Read", exact: true })).toBeChecked();
    await expect(page.getByText("Security", { exact: true }).first()).toBeVisible();
  });

  test("grouping collapses similar notifications and says how many", async ({ page }) => {
    await page.getByRole("button", { name: /Group similar/ }).click();

    await expect(page).toHaveURL(/group=1/);
    // The seeded data groups by `category:resource`, so at least one line
    // stands for more than itself.
    await expect(page.getByTestId("group-count").first()).toContainText("more");
  });

  test("marking one read and unread again moves the count both ways", async ({ page }) => {
    await page.getByText("Unread", { exact: true }).click();
    const before = Number(
      (await page.getByTestId("unread-count").textContent())?.replace(/\D/g, "") ?? "0",
    );
    expect(before).toBeGreaterThan(0);

    await page.getByRole("button", { name: /as read$/ }).first().click();
    await expect(page.getByTestId("unread-count")).toContainText(`${before - 1} unread`);

    // Put it back, so the next run of this suite starts where this one did.
    await page.getByText("Read", { exact: true }).click();
    await page.getByRole("button", { name: /as unread$/ }).first().click();
    await expect(page.getByTestId("unread-count")).toContainText(`${before} unread`);
  });

  test("the header bell carries the count and reaches the centre", async ({ page }) => {
    await page.goto("/dashboard");

    const bell = page.getByRole("banner").getByRole("button", { name: /Notifications/ });
    await expect(bell).toBeVisible();
    await bell.click();

    await expect(page.getByRole("menu", { name: "Recent notifications" })).toBeVisible();
    await page.getByRole("button", { name: "Open the notification centre" }).click();
    await expect(page).toHaveURL(/\/notifications/);
  });
});

test.describe("marking everything read", () => {
  // A different persona, so clearing the badge does not empty the centre the
  // rest of this file reads from.
  test.use({ storageState: storageStateFor("operator") });

  test("clears the unread count for good", async ({ page }) => {
    await signIn(page, "operator", "/notifications");

    const markAll = page.getByRole("button", { name: /Mark all read/ });
    if (await markAll.isEnabled()) {
      await markAll.click();
    }

    await expect(page.getByTestId("unread-count")).toHaveText("0 unread");
    await page.reload();
    await expect(page.getByTestId("unread-count")).toHaveText("0 unread");
  });
});

/**
 * The bearer token the running app is actually using.
 *
 * It lives in `keycloak-js`'s memory rather than in a cookie or storage, so
 * `page.request` on its own is unauthenticated. Reading it off a request the
 * page makes anyway means the test carries exactly the credential the browser
 * carries — no second login, no direct-grant client, nothing that could pass
 * while the real path is broken.
 */
async function bearerOf(page: Page): Promise<string> {
  const [request] = await Promise.all([
    page.waitForRequest(
      (candidate) =>
        candidate.url().includes("/platform/") &&
        Boolean(candidate.headers()["authorization"]),
    ),
    page.reload(),
  ]);
  return request.headers()["authorization"]!;
}

test.describe("notification privacy", () => {
  test("one reader cannot reach another's notification by id", async ({ browser }) => {
    // §17's acceptance criterion, end to end: the id in the path is never
    // enough on its own.
    const adminContext = await browser.newContext({ storageState: storageStateFor("admin") });
    const adminPage = await adminContext.newPage();
    await signIn(adminPage, "admin", "/notifications");
    const adminToken = await bearerOf(adminPage);

    const listed = await adminPage.request.get("/platform/notifications?page_size=5", {
      headers: { Authorization: adminToken },
    });
    expect(listed.status()).toBe(200);
    const mine = (await listed.json()) as { items: { id: string }[] };
    const someoneElses = mine.items[0]!.id;

    const viewerContext = await browser.newContext({ storageState: storageStateFor("viewer") });
    const viewerPage = await viewerContext.newPage();
    await signIn(viewerPage, "viewer", "/notifications");
    const viewerToken = await bearerOf(viewerPage);

    const stolen = await viewerPage.request.put(`/platform/notifications/${someoneElses}`, {
      headers: { Authorization: viewerToken },
      data: { is_read: true },
    });
    // Not 403: whether that id exists at all is none of the viewer's business.
    expect(stolen.status()).toBe(404);

    await adminContext.close();
    await viewerContext.close();
  });
});
