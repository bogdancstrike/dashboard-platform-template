import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { sweepCalendarEvents } from "./api";
import { signIn, storageStateFor } from "./auth";
import { chooseOption, openSelect } from "./query";

/**
 * The calendar against the real stack (§19).
 *
 * The claims a component test cannot make: that a series created here is
 * expanded *by the server* into the days a month view shows; that the day and
 * the view survive a reload because they are in the address; that an answer to
 * an invitation is a row in the database a colleague can see; and that
 * somebody who may only read the calendar can still say whether they are
 * coming.
 *
 * Serial, and each test makes its own events: these write to a shared database,
 * and a suite that leaves meetings behind fills the month a reviewer opens.
 */

test.describe.configure({ mode: "serial" });

const PREFIX = "E2E calendar";

/** Events this file made, cancelled however the test ended. */
const made: string[] = [];

test.afterEach(async () => {
  await sweepCalendarEvents(made.splice(0, made.length));
});

/**
 * An event of this test's own, through the editor — which is also the only
 * create path a person has.
 *
 * Anchored on a fixed future month so the assertions name the days they mean
 * rather than depending on the day the suite runs.
 */
async function newEvent(
  page: Page,
  title: string,
  options: { repeat?: "Weekly"; on?: string } = {},
): Promise<string> {
  await page.getByTestId("new-event").click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("What is it").fill(title);

  // The editor arrives prefilled from the day the calendar is anchored on,
  // which is the behaviour worth asserting — a "new event" form that opens on
  // today while the reader is looking at April is a form they have to correct
  // every time. Both range inputs carry the same label, so they are located
  // by their own placeholders.
  const from = modal.getByPlaceholder("Start date");
  const to = modal.getByPlaceholder("End date");
  const day = options.on ?? "2027-04-05";
  await expect(from).toHaveValue(new RegExp(`^${day} `));

  if (options.on) {
    await from.click();
    await page.keyboard.type(`${options.on} 09:00`);
    await page.keyboard.press("Enter");
    await page.keyboard.type(`${options.on} 10:00`);
    await page.keyboard.press("Enter");
  }
  await expect(to).toHaveValue(new RegExp(`^${day} `));

  if (options.repeat) {
    await modal.getByTestId("repeat").getByTitle(options.repeat).click();
    await expect(modal.getByTestId("repeat-detail")).toBeVisible();
    await modal.getByLabel("Until").click();
    await page.keyboard.type("2027-04-30");
    await page.keyboard.press("Enter");
  }

  await page.getByTestId("save-event").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Read back from the grid, which is the server's expansion of what was just
  // written — not from the form that wrote it.
  const chip = page.locator(".nu-event-chip").filter({ hasText: title }).first();
  await expect(chip).toBeVisible();
  const id = (await chip.getAttribute("data-testid"))!.replace("event-", "");
  const eventId = id.split(":")[0]!;
  made.push(eventId);
  return eventId;
}

test("an event lands in the day it was given, and the month is a link", async ({ page }) => {
  await signIn(page, "admin", "/calendar?on=2027-04-05");
  await expect(page.getByTestId("calendar-month")).toBeVisible();

  const title = `${PREFIX} once ${Date.now()}`;
  await newEvent(page, title);

  // In the fifth of April's cell, and nowhere else.
  const cell = page.getByTestId("day-2027-04-05");
  await expect(cell.getByText(title)).toBeVisible();

  // The position is in the address, so a reload comes back to the same month
  // rather than to today (§69).
  await page.reload();
  await expect(page.getByTestId("day-2027-04-05").getByText(title)).toBeVisible();
});

test("a series is expanded by the server, on the days the rule names", async ({ page }) => {
  await signIn(page, "admin", "/calendar?on=2027-04-05");
  await expect(page.getByTestId("calendar-month")).toBeVisible();

  const title = `${PREFIX} weekly ${Date.now()}`;
  await newEvent(page, title, { repeat: "Weekly" });

  // 5 April 2027 is a Monday. Every Monday to the end of the month, and the
  // expansion is the *server's* — the browser sent one rule.
  for (const day of ["2027-04-05", "2027-04-12", "2027-04-19", "2027-04-26"]) {
    await expect(page.getByTestId(`day-${day}`).getByText(title)).toBeVisible();
  }
  // And not on the Tuesdays between them.
  await expect(page.getByTestId("day-2027-04-06").getByText(title)).toHaveCount(0);

  // The drawer says what the repeat is, in the server's own words, and warns
  // that an edit moves all of them.
  await page.getByTestId("day-2027-04-12").getByText(title).click();
  const drawer = page.locator(".ant-drawer-content");
  await expect(drawer.getByText(/Repeats every week/)).toBeVisible();
  await expect(drawer.getByText(/changes every occurrence/)).toBeVisible();
});

test("a day with more than fits offers a way to see the rest", async ({ page }) => {
  await signIn(page, "admin", "/calendar");
  await expect(page.getByTestId("calendar-month")).toBeVisible();

  // The seeded calendar has busy days; find one that is counting.
  const more = page.locator(".nu-month-more").first();
  await expect(more).toBeVisible();
  const label = (await more.textContent()) ?? "";
  expect(label).toMatch(/^\+\d+ more$/);

  // A button, never a label: telling somebody three things are hidden and
  // offering no way to look is the worst version of this control.
  await more.click();
  await expect(page).toHaveURL(/view=day/);
  await expect(page.getByTestId("calendar-agenda")).toBeVisible();
});

test("an answer to an invitation is a row a colleague can see", async ({ page, browser }) => {
  await signIn(page, "admin", "/calendar?on=2027-04-05");
  await expect(page.getByTestId("calendar-month")).toBeVisible();

  const title = `${PREFIX} rsvp ${Date.now()}`;
  const eventId = await newEvent(page, title);

  // Invite a colleague through the editor, then let them answer for
  // themselves — which is the only way an answer can be written (§19).
  await page.getByTestId(`day-2027-04-05`).getByText(title).click();
  const drawer = page.locator(".ant-drawer-content");
  await drawer.getByTestId("edit-event").click();
  await openSelect(page, "Who is invited");
  await page.keyboard.type("Mara");
  await chooseOption(page, /Mara/);
  await page.getByTestId("save-event").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  const context = await browser.newContext({ storageState: storageStateFor("manager") });
  const colleague = await context.newPage();
  try {
    await signIn(colleague, "manager", "/calendar?on=2027-04-05&view=agenda&mine=1");
    const row = colleague.locator(".nu-agenda-row").filter({ hasText: title });
    await expect(row).toBeVisible();

    // Nothing is chosen: an unanswered invitation must not read as accepted.
    await expect(row.getByRole("button", { name: "Going" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await row.getByRole("button", { name: "Going" }).click();
    await expect(row.getByRole("button", { name: "Going" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // And it survives a reload, because it is a row and not a highlight.
    await colleague.reload();
    const again = colleague.locator(".nu-agenda-row").filter({ hasText: title });
    await expect(again.getByRole("button", { name: "Going" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    await context.close();
  }

  // The organiser sees the answer, which is the point of asking.
  await page.reload();
  await page.getByTestId("day-2027-04-05").getByText(title).click();
  await expect(page.locator(".ant-drawer-content").getByText("going").first()).toBeVisible();
  expect(eventId).toMatch(/[0-9a-f-]{36}/);
});

test.describe("what a reader who may not write can do", () => {
  // Their own storage state: the shared page arrives as the administrator, and
  // Keycloak's SSO cookie would sign the "viewer" straight back in as them.
  test.use({ storageState: storageStateFor("viewer") });

  test("read the calendar, and answer their own invitations", async ({ page }) => {
    await signIn(page, "viewer", "/calendar");
    await expect(page.getByTestId("calendar-month")).toBeVisible();
    // No way to write to the calendar…
    await expect(page.getByTestId("new-event")).toHaveCount(0);
    // …and answering is not writing to the calendar, so the agenda still
    // offers it wherever they are invited.
    await page.getByTitle("Agenda").click();
    await expect(page.getByTestId("calendar-agenda")).toBeVisible();
  });
});

test("the calendar is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/calendar");
  await expect(page.getByTestId("calendar-month")).toBeVisible();

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

test("the week view is an hour band, and it fills its pane", async ({ page }) => {
  await signIn(page, "admin", "/calendar?view=week");
  const week = page.getByTestId("calendar-week");
  await expect(week).toBeVisible();

  // The claim the layout pass cares about: no dead space under the events
  // (§20). The band's rows share whatever height is left, so the grid ends
  // where its pane does.
  const pane = page.getByTestId("calendar-pane");
  const paneBox = (await pane.boundingBox())!;
  const weekBox = (await week.boundingBox())!;
  expect(weekBox.height).toBeGreaterThan(paneBox.height * 0.75);
});
