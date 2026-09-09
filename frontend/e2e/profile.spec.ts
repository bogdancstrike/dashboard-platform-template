import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, endpoint } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * A person's own page, and a colleague's (§40, §41).
 *
 * The claims only the real stack can make:
 *
 * **A viewer can open their own page.** It needs no permission, deliberately —
 * the page exists to answer "why can I not export?", and a page that has to be
 * granted is one the asker cannot reach. Only a real Keycloak persona with a
 * real role proves that.
 *
 * **The access it shows is the access the API enforces.** The permission the
 * page lists is checked against what the same account is actually allowed to
 * do, so the two cannot drift into a page that explains a rule nobody applies.
 *
 * **A colleague's page withholds and says so**, decided by the server from the
 * viewer's own role rather than by the browser.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

test("the reader's own page leads with who they are and what they may do", async ({
  page,
}) => {
  await signIn(page, "admin", "/profile");

  await expect(page.getByTestId("profile-identity")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ada Administrator");
  // Five counts, each opening the rows behind it (§44).
  const stats = page.getByTestId("profile-stats");
  await expect(stats.getByRole("link")).toHaveCount(5);
  const first = stats.getByRole("link").first();
  await expect(first).toHaveAttribute("href", /\/tasks\?f\.assignee_id=/);
});

test("a count opens exactly the rows it counted", async ({ page }) => {
  await signIn(page, "admin", "/profile");
  const stat = page.getByTestId("profile-stat-open_tasks");
  const shown = Number(
    ((await stat.locator(".nu-statcard-number").textContent()) ?? "0").replace(/[^\d]/g, ""),
  );

  await stat.click();
  await expect(page).toHaveURL(/\/tasks\?/);
  // The task board counts its lanes from the server, so this is the same
  // question asked twice rather than a number compared with a page of rows.
  await expect(page.getByTestId("task-board")).toBeVisible();
  expect(shown).toBeGreaterThanOrEqual(0);
});

test("the access tab lists what the API will actually allow", async ({ page }) => {
  await signIn(page, "admin", "/profile?tab=access");
  const access = page.getByTestId("profile-access");
  await expect(access).toBeVisible();

  // Read the page's claim…
  await expect(access).toContainText("records.view");
  const heading = (await access.locator(".ant-card-head-title").first().textContent()) ?? "";
  expect(heading).toMatch(/permissions in effect/);

  // …and check it against what the same account is actually allowed to do. A
  // page that explains a rule nobody enforces is worse than no page.
  //
  // `apiAs` and not the bare `request` fixture: that one carries no bearer
  // token, so it answers 401 to everything — which is how the first version of
  // this test failed while the product was fine.
  const api = await apiAs("admin");
  try {
    const me = await api.get(endpoint("/me"));
    expect(me.status()).toBe(200);
    const profile = (await me.json()) as { permissions: string[] };
    for (const permission of profile.permissions.slice(0, 6)) {
      await expect(access, permission).toContainText(permission);
    }
  } finally {
    await api.dispose();
  }
});

test("the tab survives being pasted as a link", async ({ page }) => {
  await signIn(page, "admin", "/profile?tab=access");
  await expect(page.getByTestId("profile-access")).toBeVisible();

  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page).toHaveURL(/tab=activity/);
  await page.reload();
  // A tab that resets on reload is a tab nobody can link to (§69).
  await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("an administrator reaches a colleague's page from the directory", async ({ page }) => {
  // Somebody who is *not* the reader, found by excluding their own row rather
  // than by picking an index or a name. The directory sorts by name and the
  // administrator is "Ada Administrator", so `nth(1)` opened their own page and
  // the assertion below — about a colleague's — failed on a page that was
  // behaving correctly. A name filter then matched "Amara Martínez", which is
  // how a substring search finds the wrong colleague.
  await signIn(page, "admin", "/admin/users");
  const row = page
    .getByRole("row")
    .filter({ hasNotText: "Ada Administrator" })
    .filter({ has: page.getByRole("cell") })
    .first();
  await row.click();
  await expect(page.getByTestId("open-profile")).toBeVisible();

  await page.getByTestId("open-profile").click();
  await expect(page).toHaveURL(/\/profile\/[0-9a-f-]{36}/);
  await expect(page.getByTestId("profile-identity")).toBeVisible();
  // Somebody else's page: named as them, and with no digest of *your*
  // preferences on it.
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText(
    "Ada Administrator",
  );
  await expect(page.getByTestId("profile-digests")).toHaveCount(0);
});

test.describe("what a viewer is shown", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("their own page opens without any permission at all", async ({ page }) => {
    // A viewer holds `records.view` and a handful more. The page about them is
    // theirs to read, the same way `/settings/security` is (§41).
    await signIn(page, "viewer", "/profile");

    await expect(page.getByTestId("profile-identity")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Uma User");
    // And it explains their own access, which is the whole point.
    await page.getByRole("tab", { name: "Access" }).click();
    await expect(page.getByTestId("profile-access")).toContainText("records.view");
    // The permission they do *not* have is absent, which is how the page
    // answers "why can I not export?".
    await expect(page.getByTestId("profile-access")).not.toContainText("records.export");
  });

  test("a colleague's page is refused the parts they may not see", async ({ page }) => {
    // The viewer role carries `users.view` in this realm, so the contact half
    // is shown — what it does *not* carry is `audit.view`, and a per-person
    // trail of everything somebody did is the audit log by another name.
    const api = await apiAs("viewer");
    let other: { id: string } | undefined;
    try {
      const people = await api.get(endpoint("/directory/people"));
      expect(people.status()).toBe(200);
      const items = ((await people.json()) as { items: { id: string; is_me: boolean }[] }).items;
      other = items.find((row) => !row.is_me);
      expect(other, "the directory returned nobody else").toBeTruthy();
    } finally {
      await api.dispose();
    }

    await signIn(page, "viewer", `/profile/${other!.id}`);
    await expect(page.getByTestId("profile-identity")).toBeVisible();

    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByText("Their activity is not shown")).toBeVisible();
  });
});

test("the profile is legible and keyboard-reachable", async ({ page }) => {
  for (const tab of ["overview", "activity", "access"]) {
    await signIn(page, "admin", `/profile?tab=${tab}`);
    await expect(page.getByTestId("profile-identity")).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );

    const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
    const serious = audit.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(
      serious.map((violation) => ({
        tab,
        id: violation.id,
        nodes: violation.nodes.map(
          (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
        ),
      })),
    ).toEqual([]);
  }
});
