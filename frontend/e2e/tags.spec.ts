import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { apiAs, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Tags against the real stack (§37).
 *
 * The claim only a database can make: **the links are the truth and the array
 * is a derived cache**. Both stores existed before this feature and nothing
 * kept them in step — 44 tagged tasks against 28 tag links. So this tags a
 * record through the picker and then asserts the *list* filtered by that tag
 * finds it, which only works if the derived column was rewritten.
 *
 * Also, and only reachable through a browser: that a system tag's controls are
 * refused rather than merely failing, and that a reader without `tags.manage`
 * is told which permission is missing instead of being shown a page that does
 * nothing.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

/** A tag this file owns, removed however the test ends. */
const made: string[] = [];

test.afterEach(async () => {
  const ids = made.splice(0, made.length);
  if (ids.length === 0) return;
  const api = await apiAs("admin");
  try {
    for (const id of ids) await api.delete(namespaced(`/tags/${id}`));
  } finally {
    await api.dispose();
  }
});

async function newTag(name: string): Promise<string> {
  const api = await apiAs("admin");
  try {
    const response = await api.post(namespaced("/tags"), {
      data: { name, color: "#0f766e", category: "ENGINEERING", description: "End-to-end probe." },
    });
    expect(response.status(), await response.text()).toBe(201);
    const id = ((await response.json()) as { id: string }).id;
    made.push(id);
    return id;
  } finally {
    await api.dispose();
  }
}

/** Put one tag on the first task and return its reference. */
async function tagFirstTask(page: Page, name: string): Promise<string> {
  await signIn(page, "admin", "/tasks");
  await page.locator(".nu-task-card").first().getByRole("button", { name: /^Move / }).waitFor();
  const reference = ((await page.locator(".nu-task-ref").first().textContent()) ?? "").trim();
  await page.locator(".nu-task-card").first().click();
  await expect(page.getByTestId("record-tags")).toBeVisible();

  await page.getByTestId("record-tags-edit").click();
  // Opened first and *then* typed: AntD leaves the search input `readonly`
  // until the menu is open, so filling it straight away waits sixty seconds
  // for an element that is visible and enabled and not editable.
  //
  // Typed rather than scrolled to, because the vocabulary is twenty-odd tags
  // sorted by popularity: a new one has no usage, sits at the bottom, and
  // AntD's virtual list has not rendered it. Typing is what a person does.
  const combobox = page.getByRole("combobox", { name: "Tags" });
  await combobox.click();
  await combobox.pressSequentially(name);
  await page.locator(".ant-select-item-option-content").filter({ hasText: name }).first().click();
  await page.getByTestId("record-tags-save").click();
  await expect(page.getByTestId("record-tags")).toContainText(name);
  return reference;
}

test("a tag applied to a record makes the list filterable by it", async ({ page }) => {
  const name = `e2e-tag-${Date.now()}`;
  await newTag(name);
  const reference = await tagFirstTask(page, name);

  // Through the *tag's own link*, which is the list's `tags__contains` filter
  // over the derived column — so this passes only because the column was
  // rewritten from the links.
  await page.getByTestId("record-tags").getByRole("link", { name }).click();
  await expect(page).toHaveURL(/\/tasks\?f\.tags__contains=/);
  await expect(page.getByTestId("task-board")).toBeVisible();
  await expect(page.getByText(reference)).toBeVisible();
});

test("the vocabulary counts what it is on, and the count opens it", async ({ page }) => {
  const name = `e2e-count-${Date.now()}`;
  await newTag(name);
  await tagFirstTask(page, name);

  await page.goto("/admin/tags");
  const table = page.getByTestId("tags-table");
  await expect(table).toBeVisible();
  const row = table.locator("tr").filter({ hasText: name });
  await expect(row).toContainText("1 records");

  await row.getByRole("link").click();
  await expect(page).toHaveURL(/f\.tags__contains=/);
});

test("a system tag refuses to be renamed or removed", async ({ page }) => {
  await signIn(page, "admin", "/admin/tags");
  await expect(page.getByTestId("tags-table")).toBeVisible();

  // `urgent` is seeded as a system tag: automations and saved searches quote
  // it by name.
  await expect(page.getByTestId("tag-remove-urgent")).toBeDisabled();
  await page.getByRole("button", { name: "Edit urgent" }).click();
  await expect(page.getByTestId("tag-name")).toBeDisabled();
  await expect(page.getByText(/cannot be renamed/)).toBeVisible();
});

test("removing a tag takes it off the records it was on", async ({ page }) => {
  const name = `e2e-gone-${Date.now()}`;
  const id = await newTag(name);
  const reference = await tagFirstTask(page, name);

  await page.goto("/admin/tags");
  const row = page.getByTestId("tags-table").locator("tr").filter({ hasText: name });
  await row.getByRole("button", { name: `Remove ${name}` }).click();
  // The consequence in the question, before it happens.
  await expect(page.getByText(/It comes off 1 records/)).toBeVisible();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  made.splice(made.indexOf(id), 1);

  // And the derived column went with it: the record no longer carries the
  // name, which is the failure mode of a denormalised column with no single
  // writer.
  await page.goto(`/tasks?q=${reference}`);
  await expect(page.getByTestId("task-board")).toBeVisible();
  await page.locator(".nu-task-card").first().click();
  await expect(page.getByTestId("record-tags")).not.toContainText(name);
});

test.describe("what an operator is shown", () => {
  test.use({ storageState: storageStateFor("operator") });

  test("they may tag a record and not curate the vocabulary", async ({ page }) => {
    // An operator edits records all day — including applying tags — and still
    // does not own the vocabulary, which is a different act.
    await signIn(page, "operator", "/admin/tags");
    await expect(page.getByTestId("tags-readonly")).toContainText("tags.manage");
    await expect(page.getByTestId("tag-new")).toBeDisabled();

    await page.goto("/tasks");
    await page.locator(".nu-task-card").first().click();
    await expect(page.getByTestId("record-tags-edit")).toBeVisible();
  });
});

test("the vocabulary page is legible and keyboard-reachable", async ({ page }) => {
  await signIn(page, "admin", "/admin/tags");
  await expect(page.getByTestId("tags-table")).toBeVisible();
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
