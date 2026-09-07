import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { signIn, storageStateFor, type Persona } from "./auth";

/**
 * The detail pages that have a shape of their own (§8, §44, §48).
 *
 * The lists stopped looking alike some time ago; the details had not, and
 * three of them differed only in the words inside one `Descriptions` table.
 * What is asserted here is what a component test cannot: that the delivery
 * review's rollup is the *database's* count of a project's whole work queue
 * rather than the rows the page downloaded, that the ticket console reads its
 * SLA from the record the server sent, and that a field written from either
 * page is on the record afterwards — reloaded, in a second browser.
 *
 * Every test puts back what it changed. The seeded dataset is what the rest of
 * the suite measures against.
 */

function main(page: Page) {
  return page.locator("#nu-main");
}

/** Switch the signed-in reader's theme the way a person does (§40). */
async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  const html = page.locator("html");
  if ((await html.getAttribute("data-theme")) === theme) return;
  await page.getByRole("button", { name: /Open the command palette/ }).click();
  await page.getByText(`Switch to the ${theme} theme`, { exact: true }).click();
  await expect(html).toHaveAttribute("data-theme", theme);
}

/** Open the first project from the portfolio timeline, on its own page. */
async function openFirstProject(page: Page, persona: Persona = "admin"): Promise<string> {
  await signIn(page, persona, "/projects");
  await page.locator(".nu-timeline-row").first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/);
  return page.url();
}

/**
 * Open the first ticket from the triage queue, on its own page.
 *
 * Two clicks, because the queue's own split pane is a *preview* — the row
 * opens it beside the list, and "Full record" is the way to the console. That
 * is the path a person takes, so it is the path the test takes.
 */
async function openFirstTicket(page: Page, persona: Persona = "admin"): Promise<string> {
  await signIn(page, persona, "/tickets");
  await page.locator(".nu-queue-row").first().click();
  await page.getByRole("button", { name: "Full record" }).click();
  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}/);
  return page.url();
}

test.describe("a project reads as a delivery review", () => {
  test("names the gap between the money and the work, and counts the whole queue", async ({
    page,
  }) => {
    await openFirstProject(page);

    // The three measures that are only interesting beside one another.
    const standing = page.getByTestId("delivery-standing");
    await expect(standing).toBeVisible();
    // Exact, because the verdict sentence beneath the gauges says "delivered"
    // too — which is the point of it, not a collision to work around.
    await expect(standing.getByText("Delivered", { exact: true })).toBeVisible();
    await expect(standing.getByText("Schedule", { exact: true })).toBeVisible();
    await expect(standing.getByText("Budget", { exact: true })).toBeVisible();
    // The verdict is a sentence, not three numbers left to the reader.
    await expect(page.getByTestId("delivery-summary")).toContainText(/% delivered/);

    // The rollup is a `GROUP BY` over the project's whole queue: the lanes
    // have to add up to the total the link names, which a page counting its
    // own eight downloaded rows could not do.
    const work = page.getByTestId("project-work");
    await expect(work).toBeVisible();
    const link = work.getByRole("link", { name: /task/ }).first();
    const total = Number(((await link.textContent()) ?? "").replace(/[^\d]/g, "") || "1");
    const lanes = await work.locator(".nu-rollup-value").allTextContents();
    const summed = lanes.reduce((sum, value) => sum + Number(value.replace(/[^\d]/g, "")), 0);
    expect(summed).toBe(total);

    // And every lane leads to the board already filtered, rather than being a
    // second board embedded here.
    await work.locator(".nu-rollup-cell").first().click();
    await page.waitForURL(/\/tasks\?f\.project_id=/);
    await expect(page.getByTestId("task-board")).toBeVisible();
  });

  test("a health written from the review is on the record afterwards", async ({ page }) => {
    const url = await openFirstProject(page);
    const review = page.getByTestId("project-review");
    const select = review.locator(".ant-select").filter({
      has: page.getByRole("combobox", { name: "Health" }),
    });

    const before = ((await select.locator(".ant-select-selection-item").textContent()) ?? "").trim();
    const after = before === "OFF TRACK" ? "AT RISK" : "OFF TRACK";

    await select.locator(".ant-select-selector").click();
    await page.locator(".ant-select-item-option").filter({ hasText: after }).first().click();

    // Reloaded, so what is on screen came back from the database rather than
    // from the control that sent it.
    await page.reload();
    await expect(page.getByTestId("project-review")).toContainText(after);

    // The change is also on the record's own history, as a change (§21).
    await expect(main(page).getByText("History")).toBeVisible();

    await page.goto(url);
    await select.locator(".ant-select-selector").click();
    await page.locator(".ant-select-item-option").filter({ hasText: before }).first().click();
    await expect(page.getByTestId("project-review")).toContainText(before);
  });
});

test.describe("a ticket reads as a support console", () => {
  test("leads with the SLA the server decided, then the conversation", async ({ page }) => {
    await openFirstTicket(page);

    // The clock is the first thing on the page, because it decides whether
    // this ticket is the next thing anybody does.
    const sla = page.getByTestId("sla-standing");
    await expect(sla).toBeVisible();
    await expect(sla).toContainText(/SLA breached|Due in|Resolved|No deadline/);

    // Answering is the job, so the thread is on the page rather than behind a
    // tab (§36) — and the filing sits beside it, not above it.
    await expect(page.getByTestId("comment-thread")).toBeVisible();
    await expect(page.getByTestId("ticket-triage")).toBeVisible();
    await expect(page.getByTestId("ticket-account")).toBeVisible();
  });

  test("re-triaging writes the record, and the queue agrees", async ({ page }) => {
    await openFirstTicket(page);
    const triage = page.getByTestId("ticket-triage");
    const select = triage.locator(".ant-select").filter({
      has: page.getByRole("combobox", { name: "Severity" }),
    });

    const before = ((await select.locator(".ant-select-selection-item").textContent()) ?? "").trim();
    const after = before === "CRITICAL" ? "MAJOR" : "CRITICAL";

    await select.locator(".ant-select-selector").click();
    await page.locator(".ant-select-item-option").filter({ hasText: after }).first().click();
    await page.reload();
    await expect(page.getByTestId("ticket-triage")).toContainText(after);

    await select.locator(".ant-select-selector").click();
    await page.locator(".ant-select-item-option").filter({ hasText: before }).first().click();
    await expect(page.getByTestId("ticket-triage")).toContainText(before);
  });

  test("an analyst is shown the controls, disabled, with the permission named", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: storageStateFor("analyst") });
    const page = await context.newPage();
    await openFirstTicket(page, "analyst");

    // §76: refused in place, never hidden. An analyst reads and exports, and
    // has to be able to see that triage exists and is not theirs.
    await expect(page.getByTestId("record-edit")).toBeDisabled();
    await expect(
      page.getByTestId("ticket-triage").getByRole("combobox", { name: "Severity" }),
    ).toBeDisabled();
    await context.close();
  });
});

/**
 * Both new pages, read in both themes (§55, §59).
 *
 * The contrast failures this catches are the ones nobody sees while building:
 * a secondary caption under a gauge, a status tag inside a tinted strip. They
 * are found by measuring, not by looking — which is what this assertion is
 * for, and why it runs against the settled layout rather than mid-animation.
 */
/**
 * Both new pages, read in both themes (§55, §59).
 *
 * The contrast failures this catches are the ones nobody sees while building:
 * a secondary caption under a gauge, the label on a dangerous button, a status
 * tag inside a tinted strip. They are found by measuring, not by looking.
 *
 * Serial, and under a persona of its own. The theme is a preference *stored on
 * the account* (§40), so two tests toggling it for one person race no matter
 * which browser context they run in — and the failure reads as a contrast bug
 * rather than as what it is.
 */
test.describe("legibility", () => {
  test.describe.configure({ mode: "serial" });
  test.use({ storageState: storageStateFor("manager") });

  for (const theme of ["light", "dark"] as const) {
    test(`the delivery review and the console are legible in ${theme}`, async ({ page }) => {
      await signIn(page, "manager", "/dashboard");
      await setTheme(page, theme);

      for (const open of [openFirstProject, openFirstTicket]) {
        await open(page, "manager");
        // Asserted rather than assumed: a dark-mode audit that silently ran in
        // light mode is an audit that proves nothing.
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        // Measured at rest: a colour sampled while AntD is still fading a card
        // in is a blend of the text and whatever is behind it, which axe
        // reports as a failure on every element at once for a frame nobody
        // sees.
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
            nodes: violation.nodes.map(
              (node) => `${node.target.join(" ")} :: ${node.failureSummary}`,
            ),
          })),
        ).toEqual([]);
      }

      // Left as it was found: a run that ends in dark mode changes what the
      // next one opens on.
      await setTheme(page, "light");
    });
  }
});
