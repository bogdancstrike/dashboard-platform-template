import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

async function createDashboard(page: Page, name: string): Promise<void> {
  await signIn(page, "admin", "/dashboards");
  await page.getByTestId("new-dashboard").click();
  await expect(page.getByTestId("dashboard-header")).toContainText("New dashboard");
  await page.getByRole("button", { name: "Settings" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("textbox", { name: /Name/ }).fill(name);
  await drawer.getByTestId("save-dashboard").click();
  await expect(page.getByTestId("dashboard-header")).toContainText(name);

  // Creating one lands in edit mode, because an empty dashboard needs widgets
  // before it means anything. Asserted rather than assumed, so a test does not
  // toggle it back off by helpfully turning it on.
  await expect(page.getByTestId("add-widget")).toBeVisible();
}

async function deleteOpenDashboard(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByTestId("delete-dashboard").click();
  // The confirmation, not the drawer button that opened it: both are called
  // Delete, and one of them is still on screen behind the other.
  await page.locator(".ant-modal-confirm").getByRole("button", { name: "Delete" }).click();
}

async function addWidget(page: Page, kind: string, title: string): Promise<void> {
  await page.getByTestId("add-widget").click();
  const drawer = page.getByRole("dialog");
  await drawer
    .locator(".ant-select")
    .filter({ has: page.getByRole("combobox", { name: "Widget kind" }) })
    .locator(".ant-select-selector")
    .click();
  // The dropdown option, not the closed select's own label — both carry the
  // title, and the default kind's label is already on screen.
  await page.locator(".ant-select-item-option").filter({ hasText: kind }).first().click();
  await drawer.getByRole("textbox", { name: /Title/ }).fill(title);
  await drawer.getByTestId("save-widget").click();
  await expect(drawer).toBeHidden();
}

test("a dashboard somebody composes is still there after a reload", async ({ page }) => {
  const name = `E2E board ${Date.now()}`;
  await createDashboard(page, name);

  await addWidget(page, "Headline number", "Open tickets");
  await addWidget(page, "Bar comparison", "Tickets by severity");

  // The numbers are the database's, through the endpoints that own them: a
  // KPI reads the dataset's declared metrics, a chart the analysis compiler.
  const grid = page.getByTestId("dashboard-grid");
  await expect(grid.getByText("Open tickets")).toBeVisible();
  await expect(grid.locator("canvas").first()).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("dashboard-grid").getByText("Open tickets")).toBeVisible();
  await expect(page.getByTestId("dashboard-grid").getByText("Tickets by severity")).toBeVisible();

  await deleteOpenDashboard(page);
  await expect(page.getByText(name)).toHaveCount(0);
});

test("moving a widget from the keyboard is stored, not just drawn", async ({ page }) => {
  const name = `E2E move ${Date.now()}`;
  await createDashboard(page, name);
  await addWidget(page, "Headline number", "First tile");
  await addWidget(page, "Headline number", "Second tile");

  // §54: every gesture is also a control, so a grid can be rearranged without
  // a pointer — and the result is a write, not a local rearrangement.
  const second = page.getByTestId("dashboard-grid").locator(".nu-widget").nth(1);
  await second.getByLabel("Move or resize Second tile").click();
  await page.getByRole("menuitem", { name: /Wider/ }).click();

  await page.reload();
  // Waited for, not read the instant the reload resolves: the SPA re-checks
  // its session on a cold navigation and the first paint is torn down by the
  // redirect that follows.
  await expect(second).toBeVisible();
  // Three columns when it was added, four after one Wider — read off the grid
  // the browser actually laid out, which is what a stored width means. The
  // browser normalises the two longhands into `grid-area: <rows> / <columns>`.
  await expect(second).toHaveAttribute("style", /grid-area: span 1 \/ span 4/);

  await deleteOpenDashboard(page);
});

test("one person has one home dashboard", async ({ page }) => {
  const name = `E2E home ${Date.now()}`;
  await createDashboard(page, name);

  await page.getByRole("button", { name: "Settings" }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByLabel("My home dashboard").click();
  await drawer.getByTestId("save-dashboard").click();

  // §67: exactly one, whatever the seed left behind — a second home is a
  // preference that cannot be honoured.
  await page.reload();
  await expect(page.getByTestId("dashboard-list").locator(".anticon-home")).toHaveCount(1);

  await deleteOpenDashboard(page);
});

test("a colleague reads a shared dashboard and is refused the controls", async ({
  page,
  browser,
}) => {
  const name = `E2E shared ${Date.now()}`;
  await createDashboard(page, name);
  await addWidget(page, "Recent activity", "What just happened");

  await page.getByRole("button", { name: "Settings" }).click();
  const drawer = page.getByRole("dialog");
  // The label, not the input: AntD's Segmented hides the radio visually, and a
  // click on a zero-size element is a click on nothing.
  await drawer.locator(".ant-segmented-item", { hasText: "Everyone" }).click();
  await drawer.getByTestId("save-dashboard").click();
  await expect(drawer).toBeHidden();

  const context = await browser.newContext({ storageState: storageStateFor("manager") });
  const theirs = await context.newPage();
  await signIn(theirs, "manager", "/dashboards");
  await theirs.getByTestId("dashboard-list").getByText(name).click();

  await expect(theirs.getByTestId("dashboard-grid").getByText("What just happened")).toBeVisible();
  // §76: shown and refused, never hidden — a reader has to see that editing
  // exists and is not theirs.
  await expect(theirs.getByRole("button", { name: "Settings" })).toBeDisabled();
  await expect(theirs.getByTestId("toggle-edit")).toHaveCount(0);
  await context.close();

  await deleteOpenDashboard(page);
});

test("the grid is legible and keyboard-reachable", async ({ page }) => {
  const name = `E2E axe ${Date.now()}`;
  await createDashboard(page, name);
  await addWidget(page, "Headline number", "Open tickets");
  await addWidget(page, "What needs attention", "Alerts");

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

  await deleteOpenDashboard(page);
});
