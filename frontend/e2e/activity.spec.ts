import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The activity feed against the real stack (§35).
 *
 * The claims a component test cannot make: the counts are PostgreSQL's over
 * the whole period rather than a tally of the page, choosing a kind narrows
 * the rows without moving those counts, the question survives a reload
 * because it is in the address, and a reader with `records.view` and nothing
 * else can read the feed while the audit ledger stays shut.
 */

/** The number on a chip, which the server counted. */
async function chipCount(page: import("@playwright/test").Page, kind: string): Promise<number> {
  const text = await page.getByTestId(`activity-kind-${kind}`).locator(".nu-kindchip-count").textContent();
  return Number((text ?? "0").replace(/[^\d]/g, ""));
}

test("the counts are the period's, not the page's", async ({ page }) => {
  await signIn(page, "admin", "/activity?period=all_time");

  const strip = page.getByTestId("activity-kinds");
  await expect(strip).toBeVisible();

  // Every declared kind is offered, whether or not anything of it happened.
  for (const kind of ["RECORD", "UPDATE", "STATUS", "COMMENT", "FILE", "SECURITY", "SYSTEM"]) {
    await expect(page.getByTestId(`activity-kind-${kind}`)).toBeVisible();
  }

  // The chips add up to the headline, and the headline is larger than the
  // page — a count of the fifty rows downloaded would not be (§71).
  const rows = await page.getByTestId("activity-feed").getByRole("listitem").count();
  const total = Number(
    ((await strip.locator(".nu-kindchip").first().locator(".nu-kindchip-count").textContent()) ?? "0")
      .replace(/[^\d]/g, ""),
  );
  expect(total).toBeGreaterThan(rows);
});

test("choosing a kind narrows the feed and leaves the counts alone", async ({ page }) => {
  await signIn(page, "admin", "/activity?period=all_time");
  await expect(page.getByTestId("activity-kinds")).toBeVisible();

  // Polled rather than read once: the strip is *visible* before its numbers
  // arrive, so reading a count straight after `toBeVisible()` races the
  // response and fails in about a second with a zero. Waiting for the number
  // is the difference between asserting the count and asserting the fetch.
  await expect.poll(async () => chipCount(page, "SECURITY")).toBeGreaterThan(0);
  await expect.poll(async () => chipCount(page, "RECORD")).toBeGreaterThan(0);
  const before = await chipCount(page, "SECURITY");

  await page.getByTestId("activity-kind-SECURITY").click();
  await expect(page).toHaveURL(/kind=SECURITY/);

  // Only that kind is listed…
  const tags = page.getByTestId("activity-feed").locator(".nu-feed-meta .ant-tag");
  await expect(tags.first()).toBeVisible();
  for (const label of await tags.allInnerTexts()) {
    expect(label).toBe("Sign-ins");
  }

  // …and the *other* kinds still have their counts, which is the claim: the
  // strip counts the period, so a page that recounted the filtered result
  // would put every other chip at nought.
  //
  // Stated as "still positive" rather than "still equal", because none of
  // these numbers is stable against a live stack and neither should be: every
  // sign-in writes a SECURITY row and this suite signs in on every test, every
  // record an entity spec creates writes a RECORD row, and the workers run in
  // parallel. An equality here fails whenever a sibling spec authenticates
  // between the two reads — which is exactly how this was found, green alone
  // and red in the sweep. Nought is the only value the defect could produce,
  // so nought is the value worth excluding.
  for (const kind of ["RECORD", "UPDATE", "COMMENT"]) {
    expect(await chipCount(page, kind)).toBeGreaterThan(0);
  }
  expect(await chipCount(page, "SECURITY")).toBeGreaterThanOrEqual(before);

  // The question is in the address, so it survives a reload (§69).
  await page.reload();
  await expect(page.getByTestId("activity-kind-SECURITY")).toHaveAttribute("aria-pressed", "true");
});

test("a row opens the record it is about", async ({ page }) => {
  await signIn(page, "admin", "/activity?period=all_time&resource_type=project");

  const row = page.getByTestId("activity-feed").locator("a.nu-feed-row").first();
  await expect(row).toBeVisible();
  await row.click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}/);
});

test("an unknown kind in the address is refused, not answered emptily", async ({ page }) => {
  // The address bar is not a control this page gets to trust, and an empty
  // feed reads as "nothing happened" — a different and wrong answer (§34).
  await signIn(page, "admin", "/activity?kind=WHATEVER");
  await expect(page.getByText(/not an activity kind/i)).toBeVisible();
});

test("a viewer reads the feed while the ledger stays shut", async ({ browser }) => {
  const context = await browser.newContext({ storageState: storageStateFor("viewer") });
  const page = await context.newPage();
  try {
    await signIn(page, "viewer", "/activity?period=all_time");
    // The feed is "what has been going on" at `records.view`…
    await expect(page.getByTestId("activity-feed")).toBeVisible();
    await expect(page.getByTestId("activity-kinds")).toBeVisible();

    // …while the ledger is evidence, and needs `audit.view`.
    await page.goto("/admin/audit");
    // The refusal names the permission rather than drawing an empty page (§76).
    await expect(page.locator(".ant-result-title")).toHaveText("Permission required");
    await expect(page.locator(".ant-result-subtitle")).toContainText("audit.view");
  } finally {
    await context.close();
  }
});

test("the feed is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/activity?period=all_time");
  await expect(page.getByTestId("activity-feed")).toBeVisible();

  // Measured at rest: a colour sampled mid-transition is a blend of the text
  // and whatever is behind it.
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
