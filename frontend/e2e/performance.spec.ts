import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./auth";

/**
 * A list page is usable in under a second and a half, with the whole seeded
 * database behind it (§71).
 *
 * The number is worth a test rather than a paragraph, because performance is
 * the requirement that decays without anybody deciding to break it: one
 * accidental `page_size: 500`, one aggregate computed in the browser, one
 * component that re-renders on every keystroke, and the page that used to be
 * instant is not — and nothing fails.
 *
 * The methodology, since a number without one is a number:
 *
 * * **Signed in first.** A cold sign-in is a round trip through Keycloak and
 *   an OIDC redirect; it is not the list page, and including it would measure
 *   the identity provider.
 * * **Both ways of arriving are measured.** A full document load — the address
 *   typed, or a link followed from outside — pays for the bundle; an in-app
 *   navigation pays only for the data. Readers do both, so both are held to
 *   the budget.
 * * **Interactive, not painted.** The clock stops when the first row is
 *   *visible*, because a page with a skeleton on it cannot be acted on. The
 *   header and the facets render before the rows, so waiting for them would be
 *   measuring the shell.
 * * **The median of three.** A single run on a loaded machine measures the
 *   machine. Three is enough to discard one outlier and cheap enough to keep
 *   in the suite.
 *
 * And the design claim behind the number is asserted too: the page asks the
 * server for *one page* of rows and for the counts, rather than downloading a
 * dataset to count it in the browser. That is why the budget holds at 16 000
 * rows, and it is the thing that would quietly stop being true.
 */

/** The budget, from the tracker. One number, both ways of arriving. */
const BUDGET = 1_500;

const LISTS = [
  { path: "/tasks", nav: /Tasks/, ready: "[data-testid^='task-card-']" },
  { path: "/projects", nav: /Projects/, ready: ".ant-table-row" },
  { path: "/customers", nav: /Customers/, ready: ".nu-account, .ant-table-row" },
  { path: "/orders", nav: /Orders/, ready: ".ant-table-row" },
  { path: "/tickets", nav: /Tickets/, ready: ".ant-table-row" },
  { path: "/devices", nav: /Devices/, ready: "[data-testid='device-fleet'] > *" },
] as const;

/** The middle of three, which is the number worth asserting. */
function median(values: number[]): number {
  return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
}

/** How long until the first row is on screen, which is when the page is usable. */
async function timeUntilRows(
  page: Page,
  act: () => Promise<unknown>,
  ready: string,
): Promise<number> {
  const started = Date.now();
  await act();
  await page.locator(ready).first().waitFor({ state: "visible" });
  return Date.now() - started;
}

/** The same measurement three times, as one number. */
async function medianOf(times: number, measure: () => Promise<number>): Promise<number> {
  const runs: number[] = [];
  for (let attempt = 0; attempt < times; attempt += 1) runs.push(await measure());
  return median(runs);
}

test("every list is interactive inside the budget, cold and warm", async ({ page }) => {
  await signIn(page, "admin", "/home");
  const measured: string[] = [];

  for (const list of LISTS) {
    // Cold: the whole document, as if the address had been typed.
    const cold = await medianOf(3, () =>
      timeUntilRows(page, () => page.goto(list.path), list.ready),
    );

    // Warm: in the running application, which is how a reader moves between
    // lists all day.
    const warm = await medianOf(3, async () => {
      // Back to the front page between runs, so each measurement starts from
      // the same place rather than from the list it just measured.
      await page.getByRole("menuitem", { name: /Home/ }).click();
      await expect(page).toHaveURL(/\/home$/);
      return timeUntilRows(
        page,
        () => page.getByRole("menuitem", { name: list.nav }).click(),
        list.ready,
      );
    });

    measured.push(`${list.path}: cold ${cold}ms · warm ${warm}ms`);
    expect(cold, `${list.path} cold`).toBeLessThan(BUDGET);
    expect(warm, `${list.path} warm`).toBeLessThan(BUDGET);
  }

  // Attached rather than logged: the numbers are the point of the test, and a
  // run that passed at 1 400ms is worth seeing before it fails at 1 600.
  test.info().annotations.push({ type: "timings", description: measured.join("; ") });
});

test("the explorer is interactive inside the budget, rule builder and all", async ({ page }) => {
  // Its own case because it carries the query builder, which is the largest
  // lazy chunk in the application — and the page most likely to be blamed for
  // the bundle rather than for its data.
  await signIn(page, "admin", "/home");
  const cold = await medianOf(3, () =>
    timeUntilRows(page, () => page.goto("/explore?resource=order"), ".ant-table-row"),
  );
  expect(cold, "explorer cold").toBeLessThan(BUDGET);
});

test("a list asks for one page of rows and lets the server do the counting", async ({ page }) => {
  // Why the budget holds at sixteen thousand rows, and the thing that would
  // silently stop being true: a `page_size` raised to "just get them all", or
  // a total computed by counting an array in the browser (§71).
  const answers: { items: number; total: number; size: number }[] = [];
  page.on("response", async (response) => {
    if (!response.url().includes("/explorer/query")) return;
    try {
      const body = (await response.json()) as {
        items?: unknown[];
        total?: number;
        page_size?: number;
      };
      if (Array.isArray(body.items) && typeof body.total === "number") {
        answers.push({
          items: body.items.length,
          total: body.total,
          size: body.page_size ?? 0,
        });
      }
    } catch {
      /* not a list answer */
    }
  });

  await signIn(page, "admin", "/orders");
  await expect(page.locator(".ant-table-row").first()).toBeVisible();
  await expect(page.getByTestId("entity-total")).toBeVisible();

  expect(answers.length).toBeGreaterThan(0);
  for (const answer of answers) {
    // One page, and the page size the reader chose — never the dataset.
    expect(answer.items).toBeLessThanOrEqual(Math.max(answer.size, 200));
    expect(answer.items).toBeLessThan(answer.total);
    // The total is the server's, over every row, which is the number the
    // header shows and the number a browser could not have counted.
    expect(answer.total).toBeGreaterThan(answer.items);
  }
});
