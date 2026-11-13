import { expect, test, type Page } from "@playwright/test";

import { apiAs, endpoint } from "./api";
import { storageStateFor } from "./auth";

/**
 * Records & analytics (§12, §13, §17, §18, §22, §25) against the real stack:
 * a health breakdown, a renewal dragged between stages, one field restored
 * from history, a 3×4 block pasted into the grid and saved, an anomaly that
 * fires, and a password-protected public dashboard opened by a stranger.
 *
 * Every test makes its own records through the API and removes them however
 * it ends, so the seeded dataset the rest of the suite measures stays as it was.
 */

test.describe.configure({ mode: "serial" });
test.use({ storageState: storageStateFor("admin") });

const TAG = `zzra${Date.now()}`;
const cleanup: (() => Promise<unknown>)[] = [];

test.afterEach(async () => {
  for (const undo of cleanup.splice(0).reverse()) await undo().catch(() => undefined);
});

async function post<T>(path: string, data: unknown): Promise<T> {
  const api = await apiAs("admin");
  try {
    const response = await api.post(endpoint(path), { data });
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as T;
  } finally {
    await api.dispose();
  }
}

async function get<T>(path: string): Promise<T> {
  const api = await apiAs("admin");
  try {
    const response = await api.get(endpoint(path));
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as T;
  } finally {
    await api.dispose();
  }
}

function remove(path: string) {
  cleanup.push(async () => {
    const api = await apiAs("admin");
    try {
      await api.delete(endpoint(path));
    } finally {
      await api.dispose();
    }
  });
}

async function firstCustomer(): Promise<{ id: string; name: string }> {
  const body = await post<{ items: { id: string; name: string }[] }>("/explorer/query", {
    resource_type: "customer", columns: ["name"], page_size: 1, sort: "name", order: "asc",
  });
  return body.items[0]!;
}

test("a customer's health is explained signal by signal", async ({ page }) => {
  await page.goto("/customers/health");
  await expect(page.getByTestId("health-average")).toBeVisible();
  await page.getByTestId("health-list").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/customers\/[0-9a-f-]+\?tab=health/);
  const panel = page.getByTestId("customer-health");
  await expect(panel.getByRole("img", { name: /Health score \d+ out of 100/ })).toBeVisible();
  for (const signal of ["tickets", "orders", "usage", "renewal"]) {
    await expect(panel.getByTestId(`signal-${signal}`)).toBeVisible();
  }
  await expect(panel.getByText("Why this score")).toBeVisible();
});

async function drag(page: Page, from: string, toLane: string) {
  const card = page.getByTestId(from);
  const lane = page.locator(`[data-drop-lane="${toLane}"]`);
  await card.scrollIntoViewIfNeeded();
  const a = (await card.boundingBox())!;
  const b = (await lane.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 20);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 12, a.y + 20 + ((b.y + 80 - a.y - 20) * i) / 12);
  }
  await page.mouse.up();
}

test("a renewal is dragged from upcoming to negotiation", async ({ page }) => {
  const customer = await firstCustomer();
  const made = await post<{ id: string; reference: string }>("/contracts", {
    title: `${TAG} renewal`, customer_id: customer.id, value: 42000,
    start_date: "2026-01-01", end_date: "2027-01-01", stage: "UPCOMING",
  });
  remove(`/contracts/${made.id}`);

  await page.goto(`/contracts?q=${TAG}`);
  await expect(page.getByTestId(`contract-card-${made.reference}`)).toBeVisible();
  await drag(page, `contract-card-${made.reference}`, "NEGOTIATION");
  await expect(page.getByText(`${made.reference} → In negotiation`)).toBeVisible();
  await expect.poll(async () => (await get<{ stage: string; probability: number }>(`/contracts/${made.id}`)).stage).toBe("NEGOTIATION");
  const versions = await get<{ versions: { action: string }[] }>(`/records/contract/${made.id}/versions`);
  expect(versions.versions.at(-1)!.action).toBe("STATUS_CHANGE");
});

test("one field is restored from the history", async ({ page }) => {
  const task = await post<{ id: string }>("/records/task", { title: `${TAG} restore`, priority: "LOW" });
  remove(`/records/task/${task.id}`);
  const api = await apiAs("admin");
  await api.put(endpoint(`/records/task/${task.id}`), { data: { priority: "CRITICAL", title: `${TAG} restore, renamed` } });
  await api.dispose();

  await page.goto(`/tasks/${task.id}?versions=1`);
  const history = page.getByTestId("version-history");
  await expect(history).toBeVisible();
  await history.getByTestId("version-1").click();
  await history.getByLabel("Restore Priority").check();
  await history.getByTestId("restore-fields").click();
  await page.getByTestId("restore-confirm").click();
  await expect(page.getByText("Restored 1 field from version 1.")).toBeVisible();

  const record = await get<{ title: string; fields: { name: string; value: unknown }[] }>(`/records/task/${task.id}`);
  expect(record.fields.find((f) => f.name === "priority")!.value).toBe("LOW");
  expect(record.title).toBe(`${TAG} restore, renamed`);
  const versions = await get<{ versions: { action: string; restored_from: number | null }[] }>(`/records/task/${task.id}/versions`);
  expect(versions.versions.at(-1)).toMatchObject({ action: "RESTORE", restored_from: 1 });
});

test("a 3×4 block pasted from Excel is saved through the bulk API", async ({ page }) => {
  const ids: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const made = await post<{ id: string }>("/records/ticket", { subject: `${TAG} grid ${i}`, priority: "LOW" });
    ids.push(made.id);
    remove(`/records/ticket/${made.id}`);
  }
  await page.goto(`/tickets/grid?q=${TAG}`);
  const grid = page.getByTestId("record-grid");
  await expect(grid.locator('[data-cell="2:0"]')).toBeVisible();
  // Rows are newest first; column 0 is the subject, then description, status, priority.
  await grid.locator('[data-cell="0:0"]').click();
  const block = [
    [`${TAG} pasted A`, "From Excel", "In progress", "High"],
    [`${TAG} pasted B`, "From Excel", "Waiting customer", "Critical"],
    [`${TAG} pasted C`, "From Excel", "Assigned", "Normal"],
  ].map((row) => row.join("\t")).join("\n");
  await grid.evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, block);
  await expect(page.getByTestId("grid-pending")).toContainText("12 pending in 3 rows");
  await page.getByTestId("grid-save").click();
  await expect(page.getByText(/Updated 3 tickets/)).toBeVisible();
  await expect(page.getByTestId("grid-pending")).toHaveCount(0);

  const rows = await post<{ items: { subject: string; status: string; priority: string }[] }>("/explorer/query", {
    resource_type: "ticket", query_text: `${TAG} pasted`, columns: ["subject", "status", "priority"], page_size: 10,
  });
  expect(rows.items.map((r) => r.subject).sort()).toEqual([`${TAG} pasted A`, `${TAG} pasted B`, `${TAG} pasted C`]);
  expect(new Set(rows.items.map((r) => r.status))).toEqual(new Set(["IN_PROGRESS", "WAITING_CUSTOMER", "ASSIGNED"]));
});

test("an anomaly fires on a spike of new tickets", async ({ page }) => {
  for (let i = 0; i < 25; i += 1) {
    const made = await post<{ id: string }>("/records/ticket", { subject: `${TAG} spike ${i}`, priority: "CRITICAL" });
    remove(`/records/ticket/${made.id}`);
  }
  await page.goto("/alerts");
  await page.getByTestId("watch-new").click();
  await page.getByTestId("watch-name").fill(`${TAG} critical tickets per hour`);
  await page.locator(".ant-drawer").getByText("Hour", { exact: true }).click();
  await page.locator(".ant-drawer").getByText(/^High/).click();
  await expect(page.getByText(/point(s)? would be flagged/)).toBeVisible();
  await page.getByTestId("watch-save").click();
  await expect(page).toHaveURL(/\/alerts\/[0-9a-f-]+/);
  const id = page.url().split("/alerts/")[1]!.split("?")[0]!;
  remove(`/alerts/watches/${id}`);
  await expect(page.getByTestId("watch-detail").getByTestId("watch-status").first()).toHaveText("Anomaly");
  await expect(page.getByTestId("anomaly-row").first()).toContainText("unusual spike");
});

test("a password-protected public dashboard opens for a stranger", async ({ page, browser }) => {
  const dashboard = await post<{ id: string }>("/dashboards", { name: `${TAG} public` });
  remove(`/dashboards/${dashboard.id}`);
  await post("/dashboards/" + dashboard.id + "/widgets", { kind: "KPI", title: "Tickets", config: { entity: "ticket" } });
  await post("/dashboards/" + dashboard.id + "/widgets", { kind: "MAIL", title: "My mail", config: {} });
  const link = await post<{ token: string; path: string }>(`/dashboards/${dashboard.id}/links`, { label: "Investors", password: "open-sesame" });

  // The owner sees the link and its view count.
  await page.goto(`/dashboards?dashboard=${dashboard.id}&publish=1`);
  await expect(page.getByTestId("public-link").first()).toContainText("Investors");

  const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const visit = await stranger.newPage();
  await visit.goto(link.path);
  await expect(visit.getByTestId("public-lock")).toBeVisible();
  await visit.getByLabel("Password").fill("wrong-guess");
  await visit.getByTestId("public-unlock").click();
  await expect(visit.getByRole("alert")).toContainText("That password is not right.");
  await visit.getByLabel("Password").fill("open-sesame");
  await visit.getByTestId("public-unlock").click();
  const board = visit.getByTestId("public-dashboard");
  await expect(board).toBeVisible();
  await expect(board.getByRole("heading", { name: `${TAG} public` })).toBeVisible();
  await expect(board.getByText(/personal workspace/)).toBeVisible();
  await stranger.close();
});
