import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { sweepAutomations } from "./api";
import { signIn, storageStateFor } from "./auth";
import { RULE, chooseOption, openSelect } from "./query";

/**
 * Automations against the real stack (§49).
 *
 * The claims a component test cannot make: that the wizard's condition is
 * compiled by the *server* and comes back as the sentence the inspector shows;
 * that a dry run writes nothing — asserted by counting the notifications
 * before and after; that firing for real does write, and that firing a second
 * time is *quiet* because the cooldown is held per record; and that a rule
 * created by one person cannot be edited by another who holds the same
 * permission.
 *
 * Serial, and each test makes its own rule: these write to a shared database,
 * and a suite that leaves automations behind fills a page a reviewer opens
 * with rules that fire on their data.
 */

test.describe.configure({ mode: "serial" });

const PREFIX = "E2E automation";

/** Rules this file made, withdrawn however the test ended. */
const made: string[] = [];

test.afterEach(async () => {
  await sweepAutomations(made.splice(0, made.length));
});

/**
 * A rule of this test's own, through the wizard — which is also the only
 * create path a person has.
 *
 * Watching tasks in `NEW`: the rule has to match *something* for a dry run to
 * be worth asserting, and the seed guarantees every declared task status has
 * a task in it — which is why that guarantee exists.
 */
async function newRule(page: Page, name: string): Promise<string> {
  await page.getByTestId("new-automation").click();
  const modal = page.getByRole("dialog");

  await modal.getByLabel("What is it watching for?").fill(name);
  await openSelect(page, "Which records");
  await chooseOption(page, "Tasks");
  await page.getByTestId("wizard-next").click();

  // Step two: one condition, in the *same* editor the advanced search uses —
  // driven through the same helpers, which is the claim §49 is making.
  await expect(page.getByTestId("wizard-condition")).toBeVisible();
  // A fresh tree has no rules — the editor's first state is an empty group
  // with an "Add rule" button, which is also why `stepProblem` refuses to
  // advance from here until one exists.
  await modal.getByRole("button", { name: "Add rule" }).click();
  await modal.locator(RULE.field).first().click();
  await chooseOption(page, "Status");
  await modal.locator(RULE.value).first().click();
  await chooseOption(page, "New");
  await page.getByTestId("wizard-next").click();

  // Step three: the default notify action already reaches the rule's owner.
  await expect(page.getByTestId("action-list")).toBeVisible();
  await page.getByTestId("wizard-next").click();

  // Step four is the rehearsal, and the rule exists by now.
  await expect(page.getByTestId("wizard-rehearsal")).toBeVisible();
  await page.getByTestId("wizard-next").click();

  // The rule lives in the address, so opening it puts it there (§69).
  await expect(page).toHaveURL(/rule=[0-9a-f-]{36}/);
  const id = new URL(page.url()).searchParams.get("rule")!;
  made.push(id);
  await expect(drawerOf(page)).toBeVisible();
  return id;
}

/**
 * The rule drawer.
 *
 * Located by the drawer's own class rather than by `role="dialog"`: the wizard
 * is still animating out while the drawer opens, so for a moment both are
 * dialogs and the role query is ambiguous by construction.
 */
function drawerOf(page: Page) {
  return page.locator(".ant-drawer-content");
}

test("a rule is created paused, and its condition is compiled by the server", async ({
  page,
}) => {
  await signIn(page, "admin", "/workflows");
  await newRule(page, `${PREFIX} compile ${Date.now()}`);

  const drawer = drawerOf(page);
  // Paused, because a rule that starts firing the moment it is saved has
  // never been checked against real data.
  await expect(drawer.getByText("Paused", { exact: true })).toBeVisible();

  // And the sentence is `describe_tree`'s, not the browser's — which is what
  // makes the inspector worth having (§51).
  await expect(drawer.getByTestId("condition-text")).toContainText("Status");
  await expect(drawer.getByTestId("condition-text")).toContainText("NEW");
});

test("a dry run reports what would happen and writes nothing", async ({ page }) => {
  await signIn(page, "admin", "/workflows");
  await newRule(page, `${PREFIX} dry ${Date.now()}`);

  const drawer = drawerOf(page);
  // The server's own counter, before the rehearsal. A fresh rule has fired
  // nothing, and this is the number a *real* run moves.
  await expect(drawer.getByTestId("fired-total")).toHaveText("0");

  await drawer.getByTestId("dry-run").click();

  // Scoped to the drawer: the wizard's closing modal still holds its own
  // rehearsal report, so the page-wide testid matches twice.
  const report = drawer.getByTestId("run-report");
  await expect(report).toBeVisible();
  await expect(report.getByText("Would fire", { exact: true })).toBeVisible();
  // Something matched, or the rest of this file is asserting nothing.
  await expect(report.getByTestId("run-sample")).toBeVisible();

  // And nothing was sent: the counter is still nought after a reload, which
  // is the server's answer rather than the browser's memory of it. Asserted
  // this way and not through the API, because `api.ts` exists for cleanup —
  // every claim in this suite is made where the product is.
  await page.reload();
  await expect(drawerOf(page).getByTestId("fired-total")).toHaveText("0");

  // The run is in the history, marked a rehearsal — "we tried it" is not "it
  // happened", and the history has to keep them apart.
  await drawerOf(page).getByTitle("Runs").click();
  await expect(drawerOf(page).getByTestId("run-history")).toContainText("rehearsal");
});

test("firing for real notifies, and firing again is quiet about the same records", async ({
  page,
}) => {
  await signIn(page, "admin", "/workflows");
  const ruleId = await newRule(page, `${PREFIX} fire ${Date.now()}`);

  const drawer = drawerOf(page);
  // Enabled first: "paused" has to mean something, so a real run is refused
  // until it is switched on.
  await drawer.getByTestId("toggle-enabled").click();
  await expect(drawer.getByText("Live", { exact: true })).toBeVisible();

  await drawer.getByTestId("run-for-real").click();
  await page.getByRole("button", { name: "Run it" }).click();

  // Scoped to the drawer: the wizard's closing modal still holds its own
  // rehearsal report, so the page-wide testid matches twice.
  const report = drawer.getByTestId("run-report");
  await expect(report).toBeVisible();
  await expect(report.getByText("Fired", { exact: true })).toBeVisible();

  // The cooldown is held per record, so a second run over the same matches is
  // *supposed* to be quiet — the number that looks like a failure and is the
  // feature working.
  await drawer.getByTestId("run-for-real").click();
  await page.getByRole("button", { name: "Run it" }).click();
  await expect(report.getByText("Held back", { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const cells = report.locator(".nu-run-number-value");
      return Number((await cells.nth(1).textContent()) ?? "-1");
    })
    .toBe(0);

  // And the rule says which records it is holding back, until when.
  // By the label's `title`, not the radio: AntD's Segmented hides the input
  // off-viewport and the label is what a person actually clicks.
  await drawer.getByTitle(/Held back/).click();
  await expect(page.getByTestId("cooling-down")).toBeVisible();

  expect(ruleId).toMatch(/[0-9a-f-]{36}/);
});

test("a colleague who holds the permission still cannot edit somebody else's rule", async ({
  page,
  browser,
}) => {
  await signIn(page, "admin", "/workflows");
  const ruleId = await newRule(page, `${PREFIX} owner ${Date.now()}`);

  // A manager holds `automations.manage` too — which is exactly why the
  // ownership rule matters: an automation reaches other people's inboxes.
  // With the manager's stored session: a bare context signs in against
  // Keycloak, and the realm is brute-force protected.
  const context = await browser.newContext({ storageState: storageStateFor("manager") });
  const colleague = await context.newPage();
  try {
    await signIn(colleague, "manager", `/workflows?rule=${ruleId}`);
    const drawer = drawerOf(colleague);
    await expect(drawer).toBeVisible();
    // Readable, and rehearsable — reading what a rule would do is how anybody
    // decides whether to escalate it.
    await expect(drawer.getByTestId("dry-run")).toBeVisible();
    // But not editable, and the owner's controls are simply not offered.
    await expect(drawer.getByTestId("toggle-enabled")).toHaveCount(0);
    await expect(drawer.getByTestId("delete-automation")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test.describe("what an analyst is offered", () => {
  // Its own storage state, and not `signIn(page, "analyst", …)`: the shared
  // page arrives with the administrator's session, Keycloak's SSO cookie then
  // signs the "analyst" straight back in as the administrator, and the test
  // passes or fails for reasons that have nothing to do with the analyst.
  test.use({ storageState: storageStateFor("analyst") });

  test("nothing — the navigation does not carry the page", async ({ page }) => {
    // The condition of a rule quotes the fields and values of records its
    // reader may have no other way to see, so reading the list is privileged —
    // unlike announcements, where reading is what everybody does.
    await signIn(page, "analyst", "/dashboard");
    // A positive assertion first, so "Workflows is absent" means the reader
    // was not offered it rather than that the sidebar had not rendered.
    await expect(page.getByRole("menuitem", { name: "Reports" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Workflows" })).toHaveCount(0);
  });
});

test("the page is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/workflows");
  await expect(page.getByTestId("automation-list")).toBeVisible();

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
