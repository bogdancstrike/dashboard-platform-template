import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { apiAs, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * The system log against the real stack (§22).
 *
 * The claims a component test cannot make, and this one exists for:
 *
 * **The browser's own request is in the table.** This is the whole feature. A
 * component test can only prove the page renders what a fixture hands it; only
 * a real stack can prove that `core/logsink` wrote a row for a request the
 * browser actually made, under the correlation id that request carried — which
 * is what turns "something failed, here is an id" into an answer.
 *
 * Plus: that the severity floor is the *server's* slice of its own ordered
 * vocabulary rather than the page's guess, that the tail's cursor comes back
 * from PostgreSQL without repeating a line, and that a reader with `logs.view`
 * and nothing else is not offered the retention button.
 */

test.describe.configure({ mode: "serial" });

/**
 * The table's real rows.
 *
 * Deliberately not `tbody tr`: AntD renders its empty state as a
 * `<tr class="ant-table-placeholder">`, so counting those returns 1 for an
 * empty table. A poll waiting for "a row" therefore passes immediately, the
 * click lands on the placeholder, and the failure surfaces fifteen seconds
 * later as a missing drawer — which is exactly how this was found.
 */
function rows(page: import("@playwright/test").Page) {
  return page.getByTestId("log-table").locator("tbody tr[data-row-key]");
}

test("the page lists what the platform has been doing", async ({ page }) => {
  await signIn(page, "admin", "/admin/logs");
  await expect(page.getByTestId("log-table")).toBeVisible();

  // Rows, and every level offered whether or not anything is at it.
  const strip = page.getByTestId("log-levels");
  await expect(strip).toBeVisible();
  for (const level of ["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]) {
    await expect(page.getByTestId(`log-level-${level}`)).toBeVisible();
  }
  await expect(rows(page).first()).toBeVisible();
});

test("a request this browser made is in the log, under the id it carried", async ({
  page,
}) => {
  // The correlation id the API hands back on the response. Captured from a
  // real navigation, so this is the platform describing its own traffic.
  const ids: string[] = [];
  page.on("response", (response) => {
    const id = response.headers()["x-correlation-id"];
    // Not the log endpoints themselves: those are on the sink's ignore list
    // precisely so a viewer does not report itself.
    if (id && response.url().includes("/platform/api/") && !response.url().includes("/logs")) {
      ids.push(id);
    }
  });

  await signIn(page, "admin", "/notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  expect(ids.length).toBeGreaterThan(0);
  const wanted = ids[ids.length - 1]!;

  await page.goto(`/admin/logs?q=${wanted}`);
  await expect(page.getByTestId("log-table")).toBeVisible();

  // The sink writes after the response, so the row may land a moment later.
  await expect.poll(async () => rows(page).count(), { timeout: 20_000 }).toBeGreaterThan(0);

  // And opening it shows the request: the method, the path, and the id itself.
  await rows(page).first().click();
  await expect(page.getByTestId("line-context")).toContainText("/platform/api/");
  await expect(page.getByText(wanted)).toBeVisible();
});

test("the level filter is a floor, and the server is the one that slices it", async ({
  page,
}) => {
  await signIn(page, "admin", "/admin/logs");
  await expect(page.getByTestId("log-levels")).toBeVisible();

  /** What a level's chip says its count is. */
  const counted = async (level: string) =>
    Number(
      (
        (await page
          .getByTestId(`log-level-${level}`)
          .locator(".nu-kindchip-count")
          .textContent()) ?? "0"
      ).replace(/[^\d]/g, ""),
    );
  expect(await counted("WARNING")).toBeGreaterThan(0);
  expect(await counted("ERROR")).toBeGreaterThan(0);

  await page.getByTestId("log-level-WARNING").click();
  await expect(page).toHaveURL(/min_level=WARNING/);

  // The claim stated as arithmetic: asking for WARNING returns warnings *plus*
  // errors *plus* criticals, which is exactly what distinguishes a floor from
  // a toggle. Sampling page one cannot show it — the newest lines on a live
  // stack are frequently all of one level, which is what made the first
  // version of this test fail.
  //
  // Asked of **one response**, which is what the second version got wrong.
  // `core/logsink` writes a line for every API request, so this suite is
  // itself a writer: reading three chip counts and then a total compares two
  // instants, and the gap became a failure the moment another spec started
  // making more requests. No amount of polling fixes that, because the two
  // numbers are never taken together. The listing carries its own facets over
  // the same statement it counted, so `total` and the facet sum are one
  // instant and agree exactly — and it is the server's arithmetic, which is
  // what this test is named for.
  const api = await apiAs("admin");
  const sliced = await (
    await api.get(namespaced("/admin/logs?min_level=WARNING&page_size=1"))
  ).json();
  const levels = sliced.facets.level as Array<{ value: string; count: number }>;
  expect(levels.map((entry) => entry.value).sort()).toEqual([
    "CRITICAL",
    "ERROR",
    "WARNING",
  ]);
  expect(levels.reduce((sum, entry) => sum + entry.count, 0)).toBe(sliced.total);

  // And every row on the page is still at or above the floor.
  const shown = await page
    .getByTestId("log-table")
    .locator("tbody tr[data-row-key] td:nth-child(2)")
    .allInnerTexts();
  expect(shown.length).toBeGreaterThan(0);
  for (const level of shown) {
    expect(["warning", "error", "critical"]).toContain(level.trim());
  }
});

test("a line opens onto the rest of its request", async ({ page }) => {
  await signIn(page, "admin", "/admin/logs?min_level=ERROR");
  await expect(page.getByTestId("log-table")).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
  await rows(page).first().click();

  // The pane always answers the question, either with siblings or by saying
  // why there are none — never with an empty space (§76).
  await expect(page.getByText(/The rest of this request/)).toBeVisible();
  await expect(
    page.getByTestId("line-related").or(page.getByText(/Nothing else was logged|carries no correlation id/)),
  ).toBeVisible();
});

test("following the log delivers new lines and never the same one twice", async ({
  page,
  context,
}) => {
  await signIn(page, "admin", "/admin/logs");
  await expect(page.getByTestId("log-table")).toBeVisible();

  await page.getByTestId("toggle-live").click();
  await expect(page.getByTestId("live-banner")).toBeVisible();

  // Generate traffic the sink will log, from a second page so this one keeps
  // following. `/admin/logs` is ignored by the sink, so the viewer cannot feed
  // itself — the lines have to come from somewhere else.
  const other = await context.newPage();
  for (let index = 0; index < 3; index += 1) {
    await other.goto("/dashboard");
    await other.waitForLoadState("networkidle");
  }
  await other.close();

  await expect.poll(async () => rows(page).count(), { timeout: 30_000 }).toBeGreaterThan(0);

  // No line appears twice: the cursor is what makes a poll deliver only what
  // is new, and a tail that repeated would double the table every few seconds.
  const ids = await rows(page).evaluateAll((elements) =>
    elements.map((row) => row.getAttribute("data-row-key")),
  );
  expect(new Set(ids).size).toBe(ids.length);

  // Pausing stops the banner claiming to follow.
  await page.getByTestId("toggle-live").click();
  await expect(page.getByTestId("live-banner")).toBeHidden();
});

test.describe("what a manager is offered", () => {
  test.use({ storageState: storageStateFor("manager") });

  test("the log, and not the button that enacts the policy on it", async ({ page }) => {
    // A manager holds `logs.view` and not `settings.manage`. Reading the log
    // and applying the bound to it are different privileges, and the bound is
    // a setting.
    await signIn(page, "manager", "/admin/logs");
    await expect(page.getByTestId("log-table")).toBeVisible();
    await expect(page.getByTestId("prune-logs")).toHaveCount(0);
  });
});

test.describe("what a viewer is offered", () => {
  test.use({ storageState: storageStateFor("viewer") });

  test("nothing — the log names addresses and user ids", async ({ page }) => {
    await signIn(page, "viewer", "/admin/logs");
    await expect(page.getByTestId("log-table")).toHaveCount(0);
  });
});

test("the log is legible and keyboard-reachable", async ({ page }) => {
  for (const path of ["/admin/logs", "/admin/logs?min_level=ERROR"]) {
    await signIn(page, "admin", path);
    await expect(page.getByTestId("log-table")).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((animation) => animation.playState !== "running"),
    );

    const audit = await new AxeBuilder({ page }).include("#nu-main").analyze();
    const serious = audit.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    );
    expect(
      serious.map((violation) => ({
        path,
        id: violation.id,
        nodes: violation.nodes.map(
          (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
        ),
      })),
    ).toEqual([]);
  }
});
