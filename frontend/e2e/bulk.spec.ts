import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { apiAs, endpoint, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * One change over many records, against the real stack (§43, §75).
 *
 * The claims only a browser and a database together can make:
 *
 * **The preview counts what the server would touch**, not what the page can
 * see. A filter selection is resolved by the list's own query, so this ticks
 * nothing and selects a filter, then checks the number against the header's
 * own count.
 *
 * **A partial result is reported.** One record is deleted out from under the
 * gesture between the preview and the confirm, which is the race that happens
 * for real and the state the result panel exists to show.
 *
 * **It is audited per record.** Fifty records changed by one gesture must
 * leave the ledger saying what fifty single edits would have said — read back
 * from `/admin/audit`, not from the response.
 *
 * Every test works on tickets it created and removes them however it ends: the
 * seeded dataset is what the rest of the suite measures against, and a bulk
 * suite that leaves rows behind is the one most likely to break a test nobody
 * connects to this file.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

/** A subject nothing else in the suite matches, so the filter is this test's. */
const TAG = `zzbulk${Date.now()}`;

/** Tickets this file made, removed however the test ended. */
const made: string[] = [];

test.afterEach(async () => {
  const ids = made.splice(0, made.length);
  if (ids.length === 0) return;
  const api = await apiAs("admin");
  try {
    for (const id of ids) {
      // Not asserted: half of these are already gone, which is the point of
      // some of the tests. A failure here would report the cleanup rather than
      // the test.
      await api.delete(endpoint(`/records/ticket/${id}`));
    }
  } finally {
    await api.dispose();
  }
});

/** Three tickets sharing a subject nothing else matches. */
async function scratch(count = 3): Promise<string[]> {
  const api = await apiAs("admin");
  const ids: string[] = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const response = await api.post(endpoint("/records/ticket"), {
        data: {
          subject: `${TAG} ${index}`,
          description: "Created by the bulk end-to-end suite.",
          status: "OPEN",
          priority: "NORMAL",
          severity: "MINOR",
          category: "SUPPORT",
          channel: "EMAIL",
        },
      });
      expect(response.status(), await response.text()).toBe(201);
      const body = (await response.json()) as { id: string };
      ids.push(body.id);
      made.push(body.id);
    }
  } finally {
    await api.dispose();
  }
  return ids;
}

/**
 * The tick box on one data row, and the one in the header.
 *
 * By row rather than by `.ant-table-tbody .ant-checkbox-input`: the queue has
 * a fixed-left selection column, so that selector also matches the header's
 * "Select all" — which is then intercepted by the sticky header cell sitting
 * over it, and the failure reads as a timeout on a visible, enabled element.
 */
function rowBox(page: Page, index = 0) {
  return page.locator("tr.ant-table-row").nth(index).locator(".ant-checkbox-input");
}

function allBox(page: Page) {
  return page.getByRole("checkbox", { name: "Select all" });
}

/**
 * Choose a field and a value in the bulk dialog.
 *
 * `.ant-select-item-option` filtered by text, the way every other spec here
 * picks an option: `getByRole("option")` also resolves rc-select's hidden
 * measure item, and clicking that waits sixty seconds for something that is
 * never visible.
 */
async function choose(page: Page, field: string, value: string) {
  await page.getByTestId("bulk-field").click();
  await page.locator(".ant-select-item-option").filter({ hasText: field }).first().click();
  await page.getByTestId("bulk-value").click();
  await page.locator(".ant-select-item-option").filter({ hasText: value }).first().click();
}

/** Narrow the queue to this file's tickets and wait for the count to settle. */
async function onlyOurs(page: Page, expected: number) {
  await page.goto(`/tickets?q=${TAG}`);
  await expect(page.getByTestId("ticket-queue")).toBeVisible();
  // The header's count is the server's over the whole filtered set, which is
  // the number the bulk bar has to agree with. It reads "3 of 53" — matched of
  // the dataset — so only the first half is this file's to assert.
  // No word boundary before the number: the heading renders as
  // "Tickets3 of 53" with no space, so `\b3` never matches.
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    new RegExp(`${expected} of \\d+`),
  );
}

test("the preview counts the filtered set, not the page", async ({ page }) => {
  const ids = await scratch();
  await signIn(page, "admin", "/tickets");
  await onlyOurs(page, ids.length);

  // One row ticked, then the whole filtered set — the two decisions §75 wants
  // reported separately.
  await rowBox(page).check();
  await expect(page.getByTestId("bulk-count")).toContainText("1 ticket selected");

  await page.getByTestId("bulk-select-all").click();
  await expect(page.getByTestId("bulk-count")).toContainText(`${ids.length} tickets selected`);

  await page.getByTestId("bulk-update").click();
  await choose(page, "priority", "HIGH");

  const preview = page.getByTestId("bulk-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toContainText(`${ids.length} tickets`);
  // The split, from the server: one ticked by hand, the rest by the filter.
  await expect(preview).toContainText("1 selected by hand");
  await expect(preview).toContainText(`${ids.length - 1} matched by the filter`);
  // And the names, so the count is checkable against something.
  await expect(preview).toContainText(TAG);
});

test("one gesture changes every record, and the ledger says so per record", async ({
  page,
}) => {
  const ids = await scratch();
  await signIn(page, "admin", "/tickets");
  await onlyOurs(page, ids.length);

  await allBox(page).check();
  await expect(page.getByTestId("bulk-count")).toContainText(`${ids.length} tickets selected`);

  await page.getByTestId("bulk-update").click();
  await choose(page, "priority", "CRITICAL");
  await expect(page.getByTestId("bulk-preview")).toBeVisible();
  await page.getByTestId("bulk-confirm").click();

  const result = page.getByTestId("bulk-result");
  await expect(result).toBeVisible();
  await expect(result).toContainText(`Updated ${ids.length} tickets`);
  await page.getByTestId("bulk-done").click();

  // Read back from the server: the page's own answer is not evidence.
  const api = await apiAs("admin");
  try {
    for (const id of ids) {
      const record = await (await api.get(endpoint(`/records/ticket/${id}`))).json();
      const priority = (record as { fields: { name: string; value: unknown }[] }).fields.find(
        (field) => field.name === "priority",
      );
      expect(priority?.value).toBe("CRITICAL");
    }

    // One ledger row per record, because that is what fifty single edits would
    // have left. A bulk that audits itself once is a bulk whose third record
    // cannot be traced.
    const ledger = await (
      // `namespaced`, not `endpoint`: the ledger lives at `/platform/admin/audit`
      // rather than under `/platform/api`.
      await api.get(namespaced("/admin/audit"), {
        params: { resource_type: "ticket", action: "UPDATE", page_size: "100" },
      })
    ).json();
    const touched = new Set(
      (ledger as { items: { resource_id: string }[] }).items.map((entry) => entry.resource_id),
    );
    for (const id of ids) expect(touched.has(id), id).toBe(true);
  } finally {
    await api.dispose();
  }
});

test("a record deleted under the gesture is reported, and the rest still land", async ({
  page,
}) => {
  const ids = await scratch();
  await signIn(page, "admin", "/tickets");
  await onlyOurs(page, ids.length);

  await allBox(page).check();
  await page.getByTestId("bulk-update").click();
  await choose(page, "priority", "LOW");
  await expect(page.getByTestId("bulk-preview")).toBeVisible();

  // The race that happens for real: somebody else finishes with one of these
  // between the preview and the confirmation.
  const api = await apiAs("admin");
  try {
    const gone = await api.delete(endpoint(`/records/ticket/${ids[0]!}`));
    expect(gone.status()).toBe(200);
  } finally {
    await api.dispose();
  }

  await page.getByTestId("bulk-confirm").click();
  const result = page.getByTestId("bulk-result");
  await expect(result).toBeVisible();
  // The two that existed were changed. A gesture that rolled back on one
  // missing row would report a failure about a list that did not change.
  await expect(result).toContainText(`Updated ${ids.length - 1} tickets`);

  const check = await apiAs("admin");
  try {
    for (const id of ids.slice(1)) {
      const record = await (await check.get(endpoint(`/records/ticket/${id}`))).json();
      const priority = (record as { fields: { name: string; value: unknown }[] }).fields.find(
        (field) => field.name === "priority",
      );
      expect(priority?.value).toBe("LOW");
    }
  } finally {
    await check.dispose();
  }
});

test("deleting a selection removes exactly those records", async ({ page }) => {
  const ids = await scratch(2);
  await signIn(page, "admin", "/tickets");
  await onlyOurs(page, ids.length);

  await allBox(page).check();
  await page.getByTestId("bulk-delete").click();
  await expect(page.getByTestId("bulk-preview")).toBeVisible();
  await page.getByTestId("bulk-confirm").click();
  await expect(page.getByTestId("bulk-result")).toContainText("Deleted");
  await page.getByTestId("bulk-done").click();

  const api = await apiAs("admin");
  try {
    for (const id of ids) {
      expect((await api.get(endpoint(`/records/ticket/${id}`))).status(), id).toBe(404);
    }
  } finally {
    await api.dispose();
  }
});

test("ticking a row selects it rather than opening the record", async ({ page }) => {
  // The defect a component test found first: adding row selection to a table
  // whose rows navigate on click made the checkbox open the record, and the
  // reader lost the page they were selecting on.
  await scratch(1);
  await signIn(page, "admin", "/tickets");
  await onlyOurs(page, 1);

  await rowBox(page).check();
  await expect(page).toHaveURL(/\/tickets\?/);
  await expect(page.getByTestId("bulk-bar")).toBeVisible();
});

test("a reader who may not write is refused on the control", async ({ browser }) => {
  await scratch(1);
  const context = await browser.newContext({ storageState: storageStateFor("analyst") });
  const analyst = await context.newPage();
  try {
    // An analyst reads every record and writes none. The refusal belongs on
    // the button, not after a confirmation (§76).
    await signIn(analyst, "analyst", `/tickets?q=${TAG}`);
    await expect(analyst.getByTestId("ticket-queue")).toBeVisible();
    await rowBox(analyst).check();

    await expect(analyst.getByTestId("bulk-delete")).toBeDisabled();
    await expect(analyst.getByTestId("bulk-update")).toBeDisabled();
  } finally {
    await context.close();
  }
});

test("the selection bar and its dialog are legible and keyboard-reachable", async ({ page }) => {
  await scratch(2);
  await signIn(page, "admin", "/tickets");
  await onlyOurs(page, 2);

  await allBox(page).check();
  await page.getByTestId("bulk-delete").click();
  await expect(page.getByTestId("bulk-preview")).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => animation.playState !== "running"),
  );

  // Scoped to the page's own content, as every other axe test here is: the
  // shell has its own known issues in the dark appearance and they are not
  // this feature's to report. The dialog is a portal outside `#nu-main`, so it
  // is included by name.
  const audit = await new AxeBuilder({ page })
    .include("#nu-main")
    .include(".ant-modal-root")
    .analyze();
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
