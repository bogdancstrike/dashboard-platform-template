import { expect, type Page } from "@playwright/test";

/**
 * Driving the shared condition editor (§4, §49).
 *
 * The advanced search and the automation wizard are the *same* editor over the
 * same tree, compiled by the same `core/rules.py` — which is the whole point of
 * §49 being built on §4. So the helpers that drive it live here rather than in
 * either spec: a second copy would drift the moment the library's markup
 * changes, and then one of the two specs would be testing the old shape.
 */

/** RAQB gives its controls no accessible names, so its own classes locate them. */
export const RULE = {
  field: ".rule--field .ant-select",
  operator: ".rule--operator .ant-select",
  value: ".rule--value .ant-select",
  text: ".rule--value input",
};

/**
 * Choose an option from whichever AntD dropdown is currently open.
 *
 * A string matches the whole label; a pattern is for options that carry a
 * count or a description the test has no reason to spell out.
 */
export async function chooseOption(page: Page, label: string | RegExp): Promise<void> {
  // AntD renders `role="option"` on single selects but not on multiple ones,
  // so the open dropdown is located structurally and its items by their text.
  const option = page
    .locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")
    .filter({
      has:
        typeof label === "string" ? page.getByText(label, { exact: true }) : page.getByText(label),
    });
  await option.first().click();
}

/**
 * Open an AntD select by the label of the form field it sits in.
 *
 * The selector and not the input: `Form.Item` labels the zero-height search
 * input inside the control, and Playwright waits forever for that to be
 * "stable" — a click that never lands, reported as a timeout on a locator it
 * had already resolved.
 */
export async function openSelect(page: Page, label: string): Promise<void> {
  // By role, not by label: AntD puts the accessible name on both the wrapper
  // and the inner input, so `getByLabel` matches twice. Only the input is a
  // combobox.
  const input = page.getByRole("combobox", { name: label });
  await expect(input).toBeAttached();
  // And the *selector*, not the input: `Form.Item` labels a zero-height search
  // input inside the control, and Playwright waits forever for that to be
  // "stable" — a click that never lands, reported as a timeout.
  //
  // `ant-select-selector` and not `ant-select`: `contains()` is a substring
  // test, so the nearest ancestor "containing ant-select" is the zero-height
  // `ant-select-selection-search` wrapper — the same unclickable element by a
  // longer route.
  await input
    .locator("xpath=ancestor::div[contains(@class,'ant-select-selector')][1]")
    .click();
}
