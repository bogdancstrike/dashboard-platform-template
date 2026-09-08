import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { signIn, storageStateFor } from "./auth";

/**
 * The problem pages against the real stack (§34).
 *
 * The claims only a browser can make:
 *
 * **A wrong address answers, inside the shell.** The navigation has to survive
 * a 404 — a failure that takes the sidebar with it leaves the reader nothing
 * but the back button.
 *
 * **A forbidden route names the permission.** The shell decides this from the
 * live profile, so it can only be checked with a persona who really lacks it.
 *
 * **Every one of the six says something, legibly.** These are the pages nobody
 * looks at until the day they matter, which is the day nobody wants to
 * discover that the copy or the contrast is wrong — so the sentences and axe
 * are both asserted, on all six, in one visit each.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

/** Slug → the sentence the page must actually contain. */
const PAGES = [
  ["401", "no credential reached it"],
  ["403", "does not carry what this page needs"],
  ["404", "not one this platform serves"],
  ["500", "failed while it was being drawn"],
  ["maintenance", "API could not be reached"],
  ["session-expired", "no longer valid"],
] as const;

test("an address nobody serves answers, with the navigation intact", async ({ page }) => {
  await signIn(page, "admin", "/no-such-page-exists");

  await expect(page.getByTestId("problem-not_found")).toBeVisible();
  // The shell survived it. A failure that unmounts the navigation leaves the
  // reader with nothing but the browser's back button. The sidebar's own menu
  // rather than a role: the breadcrumb is a `nav` too, so `getByRole` matches
  // twice and a strict locator refuses both.
  await expect(page.locator(".ant-menu-root")).toBeVisible();

  // And the way out works, rather than merely being drawn.
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).not.toHaveURL(/no-such-page-exists/);
  await expect(page.getByTestId("problem-not_found")).toHaveCount(0);
});

test("each problem page says what happened, and is legible saying it", async ({
  page,
}) => {
  // Copy and contrast in one visit rather than two loops over the same six
  // addresses: each `goto` is a cold boot of the application behind a real
  // identity provider, and a suite that boots twice to ask two questions of
  // one page is a suite whose failures are about its own concurrency.
  //
  // These are the pages nobody looks at until the day they matter, which is
  // the day nobody wants to find out the copy or the contrast is wrong.
  await signIn(page, "admin", "/errors/404");

  for (const [slug, sentence] of PAGES) {
    await page.goto(`/errors/${slug}`);
    const main = page.locator("#nu-main");
    await expect(main, slug).toBeVisible();
    await expect(main, slug).toContainText(sentence);
    // Never a dead end, whatever failed.
    await expect(page.getByRole("link", { name: "Back to home" }), slug).toBeVisible();

    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );
    const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
    const serious = audit.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(
      serious.map((violation) => ({
        slug,
        id: violation.id,
        nodes: violation.nodes.map(
          (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
        ),
      })),
    ).toEqual([]);
  }
});

test("a retry is offered only where retrying could work", async ({ page }) => {
  await signIn(page, "admin", "/errors/500");
  // A render fault often is one bad response; asking again is a real answer.
  await expect(page.getByTestId("problem-retry")).toBeVisible();

  await page.goto("/errors/404");
  // And asking again for an address that does not exist is a button that
  // fails identically on the second press.
  await expect(page.getByTestId("problem-retry")).toHaveCount(0);
});

test.describe("a reader who may not open the page", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("is told which permission it needs, by name", async ({ page }) => {
    // A viewer does not hold `audit.view`, and the address is a real one — so
    // this is the shell's own decision, made from the live profile, and not a
    // demonstration page. Not `/admin/users`, which the first version of this
    // test used: a viewer *does* hold `users.view` — the directory is readable
    // by design — so it asserted a refusal that was never going to come.
    await signIn(page, "viewer", "/admin/audit");

    await expect(page.getByTestId("problem-forbidden")).toBeVisible();
    // "You do not have permission" tells somebody nothing they can ask for.
    await expect(page.getByTestId("problem-missing")).toContainText("audit.view");
  });
});
