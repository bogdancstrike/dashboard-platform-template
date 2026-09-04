import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./auth";

/**
 * Data Explorer against the real stack (§4, §6, §51).
 *
 * The advanced builder is the one feature no other test level can vouch for:
 * it is a third-party editor configured from a catalogue the API publishes, and
 * every way it has broken so far was invisible to unit tests. Adding a rule
 * silently did nothing, because the tree round-tripped through the URL and the
 * library discards empty rules on load. Operator dropdowns came up empty,
 * because the operators were translated globally instead of per widget type.
 * Rules rendered as unstyled stacked boxes, because the library's stylesheet is
 * scoped under a wrapper the host application has to render. Each of those
 * builds, typechecks and passes a component test.
 *
 * So this suite drives the editor the way a person does, and asserts on what
 * they would see: the number of matches, the sentence in the query inspector,
 * and the same rows after a reload.
 */

/** RAQB gives its controls no accessible names, so its own classes locate them. */
const RULE = {
  field: ".rule--field .ant-select",
  operator: ".rule--operator .ant-select",
  value: ".rule--value .ant-select",
  text: ".rule--value input",
};

async function openAdvanced(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Advanced" }).click();
  await expect(page.getByRole("button", { name: "Add rule" })).toBeVisible();
}

/**
 * Choose an option from whichever AntD dropdown is currently open.
 *
 * A string matches the whole label; a pattern is for options that carry a
 * count or a description the test has no reason to spell out.
 */
async function chooseOption(page: Page, label: string | RegExp): Promise<void> {
  // AntD renders `role="option"` on single selects but not on multiple ones,
  // so the open dropdown is located structurally and its items by their text.
  const option = page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
    .filter({
      has: typeof label === "string" ? page.getByText(label, { exact: true }) : page.getByText(label),
    });
  await option.first().click();
}

/**
 * The number of matches, once it belongs to the question currently on screen.
 *
 * The page marks itself "Updating…" from the keystroke rather than from the
 * request, so waiting for that to clear covers both the debounce and the fetch.
 * Reading the tag without it returns the answer to the previous question, which
 * is how a passing assertion here would mean nothing.
 */
async function matchCount(page: Page): Promise<number> {
  await expect(page.getByTestId("explorer-settling")).toBeHidden();
  const text = await page.getByTestId("explorer-match-count").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/**
 * What the draft in the advanced editor *would* match, once the preview has
 * caught up with it. The editor composes a draft and the page keeps showing the
 * last question that was run, so this is the number that moves while a rule is
 * being built — and the number the Search button promises.
 */
async function previewCount(page: Page): Promise<number> {
  await expect(page.getByText("Previewing…")).toBeHidden();
  const text = await page.getByTestId("preview-count").locator(".ant-statistic-content").innerText();
  return Number(text.replace(/[^\d]/g, ""));
}

/** Build the nth rule in the open editor as `Status = <value>`. */
async function addStatusRule(page: Page, value: string, index = 0): Promise<void> {
  await page.getByRole("button", { name: "Add rule" }).click();
  await page.locator(RULE.field).nth(index).click();
  await chooseOption(page, "Status");
  await page.locator(RULE.value).nth(index).click();
  await chooseOption(page, value);
}

async function runSearch(page: Page): Promise<void> {
  await page.getByTestId("run-advanced-search").click();
  await expect(page.getByTestId("preview-count")).toBeHidden();
}

test.describe("Data Explorer", () => {
  test.beforeEach(async ({ page }) => signIn(page, "admin", "/explore"));

  test("lists a dataset with the columns the catalogue declared", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Data Explorer" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Reference" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
    expect(await matchCount(page)).toBeGreaterThan(0);
  });

  test("simple search narrows the rows and survives a reload", async ({ page }) => {
    const total = await matchCount(page);

    await page.getByPlaceholder("Search tasks…").fill("audit");
    await expect.poll(() => matchCount(page)).toBeLessThan(total);
    const narrowed = await matchCount(page);

    // §69: the question lives in the URL, so it can be pasted to a colleague.
    expect(new URL(page.url()).searchParams.get("q")).toBe("audit");
    await page.reload();
    await expect(page.getByPlaceholder("Search tasks…")).toHaveValue("audit");
    await expect.poll(() => matchCount(page)).toBe(narrowed);
  });

  test("a draft condition only reaches the results when Search is pressed", async ({ page }) => {
    const total = await matchCount(page);
    await openAdvanced(page);
    await addStatusRule(page, "Blocked");

    // The inspector is rendered by the backend from the tree it compiled, so
    // this asserts what would actually run, not what the editor believes.
    await expect(page.getByTestId("query-inspector")).toHaveText("Status = 'BLOCKED'");
    const blocked = await previewCount(page);
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(total);

    // Nothing behind the drawer has moved yet: the draft was never run.
    await runSearch(page);
    await expect.poll(() => matchCount(page)).toBe(blocked);

    // Every row that came back really does have that status.
    expect(await page.getByRole("cell", { name: "BLOCKED" }).count()).toBe(Math.min(blocked, 25));

    // §69: the whole tree round-trips, editor and results alike.
    await page.reload();
    await expect.poll(() => matchCount(page)).toBe(blocked);
    await openAdvanced(page);
    await expect(page.getByTestId("query-inspector")).toHaveText("Status = 'BLOCKED'");
  });

  test("closing the editor without searching leaves the question alone", async ({ page }) => {
    const total = await matchCount(page);

    await openAdvanced(page);
    await addStatusRule(page, "Blocked");
    expect(await previewCount(page)).toBeLessThan(total);
    await page.getByRole("button", { name: "Close" }).click();

    expect(await matchCount(page)).toBe(total);
    // And the discarded draft is not waiting there on the next visit.
    await openAdvanced(page);
    await expect(page.getByTestId("query-inspector")).toHaveText("All records");
  });

  test("groups nest, and NOT inverts the group it is on", async ({ page }) => {
    await openAdvanced(page);
    await addStatusRule(page, "Blocked");
    await expect(page.getByTestId("query-inspector")).toHaveText("Status = 'BLOCKED'");
    const blocked = await previewCount(page);

    // A second rule under OR must widen the answer, not narrow it.
    await addStatusRule(page, "Cancelled", 1);
    await page.getByRole("button", { name: "Or", exact: true }).click();
    await expect(page.getByTestId("query-inspector")).toContainText("OR");
    await expect.poll(() => previewCount(page)).toBeGreaterThan(blocked);
    const either = await previewCount(page);

    await page.getByRole("button", { name: "Not", exact: true }).click();
    await expect(page.getByTestId("query-inspector")).toContainText("NOT");
    await expect.poll(() => previewCount(page)).toBeGreaterThan(either);
  });

  test("a draft can be named and saved without running it first (§5)", async ({ page }) => {
    const alias = `Blocked work ${Date.now()}`;
    await openAdvanced(page);
    await addStatusRule(page, "Blocked");
    const blocked = await previewCount(page);

    await page.getByRole("button", { name: "Save as…" }).click();
    await page.getByLabel("Name").fill(alias);
    await page.getByRole("button", { name: "Save search" }).click();

    // Saving runs it too: a named search that shows other rows is a name
    // nobody would trust the next time they open it.
    await expect(page.getByText("Search saved")).toBeVisible();
    await expect.poll(() => matchCount(page)).toBe(blocked);

    // And it is there, by name, for the next person to open.
    await page.getByRole("button", { name: "Saved searches" }).click();
    await expect(page.getByRole("button", { name: alias, exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Delete ${alias}` }).click();
    await page.getByRole("button", { name: "OK" }).click();
    await expect(page.getByText("Saved search deleted")).toBeVisible();
  });

  test("a rule can be duplicated in place", async ({ page }) => {
    await openAdvanced(page);
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.locator(RULE.field).first().click();
    await chooseOption(page, "Status");

    await page.getByRole("button", { name: "Duplicate this rule" }).click();

    await expect(page.locator(RULE.field)).toHaveCount(2);
    // The copy carries the original's field rather than starting blank.
    await expect(page.locator(".rule--field").nth(1)).toContainText("Status");
  });

  test("an unfinished rule narrows nothing", async ({ page }) => {
    const total = await matchCount(page);
    await openAdvanced(page);

    await page.getByRole("button", { name: "Add rule" }).click();
    await expect(page.locator(RULE.field)).toHaveCount(1);
    await page.locator(RULE.field).first().click();
    await chooseOption(page, "Status");

    // A field with no value yet is not a filter; §4 says so, the backend
    // agrees, and the preview count is how a user finds out.
    await expect(page.getByTestId("query-inspector")).toHaveText("All records");
    expect(await previewCount(page)).toBe(total);
  });

  test("a facet filters by a value that is actually present", async ({ page }) => {
    const total = await matchCount(page);

    await page.getByTestId("facet-priority").click();
    await chooseOption(page, /^CRITICAL/);
    await page.keyboard.press("Escape");

    await expect.poll(() => matchCount(page)).toBeLessThan(total);
    expect(new URL(page.url()).searchParams.get("f.priority")).toBe("CRITICAL");
  });

  test("every result mode renders the same answer", async ({ page }) => {
    const total = await matchCount(page);

    for (const mode of ["List", "Cards", "Compact"]) {
      // AntD hides the Segmented radio itself; the label is what a user clicks.
      await page.getByTestId("view-mode").getByText(mode, { exact: true }).click();
      await expect.poll(() => matchCount(page)).toBe(total);
      await expect(page.getByText("No records match this question")).toBeHidden();
    }
  });

  test("another dataset brings its own fields", async ({ page }) => {
    await page.getByTestId("dataset-select").click();
    await chooseOption(page, /^Devices/);

    await expect(page.getByRole("columnheader", { name: "Serial" })).toBeVisible();
    await openAdvanced(page);
    await page.getByRole("button", { name: "Add rule" }).click();
    await page.locator(RULE.field).first().click();
    // The list is virtualised, so a field far down it is found by searching.
    await page.keyboard.type("Battery");

    // Declared by the device resource, and by no other.
    await chooseOption(page, "Battery percent");
    await expect(page.locator(".rule--field").first()).toContainText("Battery percent");
  });
});
