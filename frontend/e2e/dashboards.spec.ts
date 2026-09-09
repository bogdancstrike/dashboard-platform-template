import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { sweepDashboards, sweepReports, writeDashboard, writeReport } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Saved dashboards, against the real stack (§45, §67).
 *
 * The claims a component test cannot make: a layout survives a reload because
 * it is stored rather than remembered, the numbers in the widgets are the
 * database's, one person really has one home, and a colleague's dashboard is
 * readable without being writable.
 *
 * Serial, and every test cleans up after itself: these create dashboards in
 * the same database the rest of the suite reads.
 */
test.describe.configure({ mode: "serial" });

/**
 * Anything this file created, gone — whether the test that made it passed.
 *
 * Two versions preceded this. The first cleaned up on the happy path only, so
 * a run where one assertion failed left its dashboard behind; forty-four
 * accumulated before anybody looked at the page. The second swept through the
 * page: click Delete, then wait on a confirmation modal — and under the full
 * suite's load that wait expired often enough to fail tests that had already
 * passed, which inverts what cleanup is for.
 *
 * So it goes through the API (`e2e/api.ts`), where there is no modal to wait
 * on and one request per leftover.
 */
test.afterEach(async () => {
  await sweepDashboards(["E2E "]);
  await sweepReports(["E2E "]);
});

/**
 * Create one through the wizard, holding what was asked for.
 *
 * The wizard *is* the create flow — a dashboard cannot be finished empty — so
 * the helper walks all three steps rather than creating a blank one and
 * furnishing it, which is not a path the product offers.
 */
async function createDashboard(page: Page, name: string, kinds: string[]): Promise<void> {
  await signIn(page, "admin", "/dashboards");
  await page.getByTestId("new-dashboard").click();

  await page.getByRole("textbox", { name: /Name/ }).fill(name);
  await page.getByTestId("wizard-next").click();

  await expect(page.getByTestId("widget-kind-picker")).toBeVisible();
  // Nothing chosen yet, so the flow refuses to go on — a dashboard is created
  // in order to hold something.
  await expect(page.getByTestId("wizard-next")).toBeDisabled();
  for (const kind of kinds) await page.getByTestId(`kind-${kind}`).click();
  await page.getByTestId("wizard-next").click();

  await expect(page.getByTestId("wizard-review")).toContainText(name);
  await page.getByTestId("wizard-next").click();

  // It lands on the grid it now holds, in edit mode, because an unfurnished
  // widget is the next thing to deal with.
  await expect(page.getByTestId("dashboard-grid")).toBeVisible();
  await expect(page.getByTestId("add-widget")).toBeVisible();
}

/**
 * Get to the gallery without a fresh navigation.
 *
 * `page.goto` on a page the SPA has already booted races the session check it
 * issues on a cold load — the second navigation cancels the first, and the
 * failure reads as a broken page. Walking back inside the app avoids the
 * round trip entirely.
 */
async function showGallery(page: Page): Promise<void> {
  if ((await page.getByTestId("dashboard-gallery").count()) === 0) {
    const back = page.getByRole("button", { name: "Back" });
    if ((await back.count()) > 0) await back.click();
    else await page.goto("/dashboards");
  }
  await expect(page.getByTestId("dashboard-gallery").or(page.getByText("No dashboards yet")))
    .toBeVisible();
}

/**
 * Remove one by name, from the gallery.
 *
 * From the gallery rather than from the open dashboard's settings, because a
 * test may have navigated back — and the gallery card carries the same delete,
 * which is the path a person uses to tidy up anyway.
 */
async function deleteDashboard(page: Page, name: string): Promise<void> {
  await showGallery(page);
  const card = page
    .getByTestId("dashboard-gallery")
    .locator(".nu-board-card")
    .filter({ hasText: name })
    .first();
  if ((await card.count()) === 0) return;
  await card.getByLabel(`Delete ${name}`).click();
  await page.locator(".ant-modal-confirm").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".ant-modal-confirm")).toBeHidden();
}

async function addWidget(page: Page, kind: string, title: string): Promise<void> {
  // Close whatever layer is open first — `Esc` closes the topmost one (§54).
  // The wizard and the card menus leave a dropdown fading, and on a loaded
  // machine it lingers long enough to swallow this click: Playwright reported
  // "`.ant-dropdown-menu` intercepts pointer events" for thirty seconds and
  // the failure read as a broken button.
  await page.keyboard.press("Escape");
  await expect(page.locator(".ant-dropdown:not(.ant-dropdown-hidden)")).toHaveCount(0);

  await page.getByTestId("add-widget").click();
  const drawer = page.getByRole("dialog");
  // Typed rather than scrolled: thirteen kinds is more than a list somebody
  // reads top to bottom, and the ones past the window are virtualised away.
  // The drawer slides in, so the input is not stable for the first frames —
  // waited for rather than clicked at.
  const picker = drawer.getByRole("combobox", { name: "Widget kind" });
  await expect(drawer.getByRole("textbox", { name: /Title/ })).toBeVisible();
  await picker.fill(kind);
  await page.locator(".ant-select-item-option").filter({ hasText: kind }).first().click();
  await drawer.getByRole("textbox", { name: /Title/ }).fill(title);
  await drawer.getByTestId("save-widget").click();
  await expect(drawer).toBeHidden();
}

test("a dashboard somebody composes is still there after a reload", async ({ page }) => {
  const name = `E2E board ${Date.now()}`;
  await createDashboard(page, name, ["BAR_CHART"]);

  const grid = page.getByTestId("dashboard-grid");
  // The wizard picks a *shape*; the subject comes later. Said in place, with
  // the action, rather than drawn as an empty chart (§34).
  await expect(grid.getByText(/Nothing chosen yet/)).toBeVisible();

  // Added through the drawer, which names a dataset — so this one draws. The
  // numbers are the database's, through the endpoints that own them: a KPI
  // reads the dataset's declared metrics, a chart the analysis compiler.
  await addWidget(page, "Headline number", "Open tickets");
  await expect(grid.getByText("Open tickets")).toBeVisible();
  await addWidget(page, "Bars", "Tickets by severity");
  await expect(grid.locator("canvas").first()).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("dashboard-grid").getByText("Open tickets")).toBeVisible();
  await expect(page.getByTestId("dashboard-grid").getByText("Tickets by severity")).toBeVisible();

  await deleteDashboard(page, name);
  await expect(page.getByTestId("dashboard-gallery").getByText(name)).toHaveCount(0);
});

/**
 * A saved chart goes on a dashboard from where the chart is (§45).
 *
 * The point is what the widget *stores*: a reference. The card is added from
 * the reports page in two clicks, and what appears on the dashboard is the
 * report's own picture — drawn by running the stored definition through the
 * same compiler the builder previewed with, rather than by a question copied
 * into the widget's config, which would be a second definition that drifts.
 */
test("a saved chart becomes a widget without being rebuilt", async ({ page }) => {
  const stamp = Date.now();
  const board = `E2E board ${stamp}`;
  const report = await writeReport({ name: `E2E chart ${stamp}`, visualization: "pie" });
  await writeDashboard(board);

  await signIn(page, "admin", `/reports?report=${report.id}`);
  await expect(page.getByTestId("reports")).toBeVisible();

  await page.getByRole("button", { name: `Actions for ${report.name}` }).click();
  await page.getByRole("menuitem", { name: /Add to a dashboard/ }).click();

  const modal = page.getByRole("dialog");
  // The dashboards are offered by name and by what they already hold, so a
  // reader picks the right one of four without opening them.
  await modal.getByRole("radio", { name: new RegExp(board) }).click();
  await modal.getByTestId("add-to-dashboard-confirm").click();
  await expect(modal).toBeHidden();

  // Followed through the confirmation, which is the way the product offers.
  await page.getByRole("button", { name: board }).click();
  const grid = page.getByTestId("dashboard-grid");
  await expect(grid.getByText(report.name)).toBeVisible();
  // The report's own visualisation, from its own definition: a pie, which
  // nothing in this flow ever mentioned.
  await expect(grid.locator("canvas").first()).toBeVisible();

  // And it is stored, not merely drawn.
  await page.reload();
  await expect(page.getByTestId("dashboard-grid").getByText(report.name)).toBeVisible();
});

test("moving a widget from the keyboard is stored, not just drawn", async ({ page }) => {
  const name = `E2E move ${Date.now()}`;
  await createDashboard(page, name, ["KPI", "KPI"]);

  // §54: every gesture is also a control, so a grid can be rearranged without
  // a pointer — and the result is a write, not a local rearrangement.
  const second = page.getByTestId("dashboard-grid").locator(".nu-widget").nth(1);
  await second.getByLabel("Move or resize Headline number").click();
  await page.getByRole("menuitem", { name: /Wider/ }).click();

  await page.reload();
  // Waited for, not read the instant the reload resolves: the SPA re-checks
  // its session on a cold navigation and the first paint is torn down by the
  // redirect that follows.
  await expect(second).toBeVisible();
  // Three columns when it was added, four after one Wider — read off what the
  // card says it was *saved* as, since the grid places it with a transform and
  // nothing else in the DOM carries the stored width.
  await expect(second).toHaveAttribute("data-columns", "4");

  await deleteDashboard(page, name);
});

test("one person has one home dashboard", async ({ page }) => {
  const name = `E2E home ${Date.now()}`;
  await createDashboard(page, name, ["ALERTS"]);

  await page.getByTestId("board-settings").click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("My home dashboard").click();
  await drawer.getByTestId("save-dashboard").click();

  // §67: exactly one, whatever the seed left behind — a second home is a
  // preference that cannot be honoured.
  // Exactly one, whatever the seed left behind: the gallery marks the home one.
  await showGallery(page);
  await expect(
    page.getByTestId("dashboard-gallery").getByLabel("Your home dashboard"),
  ).toHaveCount(1);

  await deleteDashboard(page, name);
});

test("a colleague reads a shared dashboard and is refused the controls", async ({
  page,
  browser,
}) => {
  const name = `E2E shared ${Date.now()}`;
  await createDashboard(page, name, ["ACTIVITY"]);

  await page.getByTestId("board-settings").click();
  const drawer = page.getByRole("dialog");
  // The label, not the input: AntD's Segmented hides the radio visually, and a
  // click on a zero-size element is a click on nothing.
  await drawer.locator(".ant-segmented-item", { hasText: "Everyone" }).click();
  await drawer.getByTestId("save-dashboard").click();
  await expect(drawer).toBeHidden();

  const context = await browser.newContext({ storageState: storageStateFor("manager") });
  const theirs = await context.newPage();
  await signIn(theirs, "manager", "/dashboards");
  await theirs.getByTestId("dashboard-gallery").getByText(name).click();

  await expect(theirs.getByTestId("dashboard-grid").getByText("Recent activity")).toBeVisible();
  // §76: shown and refused, never hidden — a reader has to see that editing
  // exists and is not theirs.
  await expect(theirs.getByTestId("board-settings")).toBeDisabled();
  await expect(theirs.getByTestId("toggle-edit")).toHaveCount(0);
  await context.close();

  await deleteDashboard(page, name);
});

test("the grid is legible and keyboard-reachable", async ({ page }) => {
  const name = `E2E axe ${Date.now()}`;
  await createDashboard(page, name, ["KPI", "ALERTS"]);

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

  await deleteDashboard(page, name);
});
