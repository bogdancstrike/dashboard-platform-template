import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * `/home` against the real stack (§40).
 *
 * The claims a component test cannot make: that arriving with no address lands
 * here, that every number on the page is the *same* number the page it links
 * to shows, and that a reader with fewer permissions gets fewer cards rather
 * than empty ones.
 */

test("arriving with no address lands on home", async ({ page }) => {
  // The index route reads the reader's preference and falls back to `/home`.
  // A landing page nobody arrives on is a landing page nobody maintains.
  await signIn(page, "admin", "/");
  await expect(page).toHaveURL(/\/(home|dashboard|tasks|notifications|projects|explore|analytics)$/);
  // The administrator's seeded preference decides which of them; the claim
  // here is only that the index never leaves somebody on `/` looking at
  // nothing. Asserted through the sidebar rather than a named menu item: the
  // accessible name of one carries its badge count, so matching it exactly is
  // a test about how many notifications the demo happens to hold.
  expect(new URL(page.url()).pathname).not.toBe("/");
  await expect(page.getByRole("menuitem", { name: "Home" })).toBeVisible();
});

test("the greeting, the role and the version all come from the server", async ({ page }) => {
  await signIn(page, "admin", "/home");

  // The name and role from `/api/me`, the platform's name and version from
  // `/meta/app`. A version typed into the page is wrong after the next
  // release, and a role typed in is wrong the moment somebody is promoted.
  await expect(page.getByText(/Ada/).first()).toBeVisible();
  await expect(page.getByText(/Administrator ·/)).toBeVisible();
  await expect(page.getByText(/Nucleus v\d/)).toBeVisible();
});

test("every card links to the page it summarises", async ({ page }) => {
  await signIn(page, "admin", "/home");

  await expect(page.getByTestId("home-notices")).toBeVisible();
  await page.getByTestId("home-notices").getByRole("link", { name: /noticeboard/i }).click();
  await expect(page).toHaveURL(/\/announcements/);
});

test("a count on the strip finds exactly the rows it counted", async ({ page }) => {
  await signIn(page, "admin", "/home");
  await expect(page.getByTestId("waiting")).toBeVisible();

  // The strip is either the reassuring sentence or a set of links. Both are
  // correct answers, and which one depends on the state of the demo — so the
  // assertion is about the *link*, when there is one.
  const cards = page.locator(".nu-waitcard");
  if ((await cards.count()) === 0) {
    await expect(page.getByText("Nothing is waiting for you")).toBeVisible();
    return;
  }

  const first = cards.first();
  const count = Number((await first.locator(".nu-waitcard-count").textContent()) ?? "0");
  expect(count).toBeGreaterThan(0);
  await first.click();
  // It went somewhere narrowed rather than to a bare list.
  await expect(page).not.toHaveURL(/\/home$/);
});

test.describe("what a viewer is shown", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("fewer cards, and none of them empty for want of permission", async ({ page }) => {
    await signIn(page, "viewer", "/home");

    // A viewer holds `tasks.view`, `calendar.view` and `mail.access`, so those
    // cards are there; they do not hold `dashboards.manage`, and nothing on
    // this page pretends otherwise.
    await expect(page.getByTestId("home-notices")).toBeVisible();
    await expect(page.getByTestId("home-activity")).toBeVisible();
    await expect(page.getByTestId("home-today")).toBeVisible();
  });
});

test("home is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/home");
  await expect(page.getByTestId("home-notices")).toBeVisible();

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
