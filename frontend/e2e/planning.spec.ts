import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { apiAs, endpoint } from "./api";

/**
 * Work planning against the real stack (§18): a bar dragged on the timeline is
 * rescheduled in the database, a dependency drawn between two bars is stored,
 * a backlog item dragged into a sprint joins it, and the burndown draws from
 * the seeded history. Each test makes its own tasks and sprint and removes
 * them, so the seeded plan is never moved.
 */

test.describe.configure({ mode: "serial" });

const PREFIX = "E2E plan";
let api: APIRequestContext;
let project = "";
const tasks: string[] = [];
const sprints: string[] = [];

function day(offset: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function makeTask(title: string, start: number, due: number): Promise<{ id: string; reference: string }> {
  const made = await api.post(endpoint("/records/task"), {
    data: { title: `${PREFIX} ${title}`, status: "NEW", project_id: project, start_date: day(start), due_date: day(due), story_points: 3 },
  });
  expect(made.status(), await made.text()).toBe(201);
  const body = (await made.json()) as { id: string; subtitle: string };
  tasks.push(body.id);
  return { id: body.id, reference: body.subtitle };
}

async function fieldOf(id: string, name: string): Promise<unknown> {
  const response = await api.get(endpoint(`/records/task/${id}`));
  const body = (await response.json()) as { fields: { name: string; value: unknown }[] };
  return body.fields.find((field) => field.name === name)?.value;
}

/** A real pointer drag, in steps, so the app sees the travel. */
async function drag(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = (await from.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 6, box.y + box.height / 2, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test.beforeAll(async () => {
  api = await apiAs("admin");
  const response = await api.post(endpoint("/explorer/query"), {
    data: { resource_type: "project", filters: { status: "ACTIVE" }, columns: ["code"], page: 1, page_size: 1, sort: "code" },
  });
  project = ((await response.json()) as { items: { id: string }[] }).items[0]!.id;
});

test.afterAll(async () => {
  for (const id of sprints.splice(0)) await api.delete(endpoint(`/work/sprints/${id}`));
  for (const id of tasks.splice(0)) await api.delete(endpoint(`/records/task/${id}`));
  await api.dispose();
});

test("a bar dragged on the timeline is rescheduled", async ({ page }) => {
  const task = await makeTask("drag me", 2, 4);
  await page.goto(`/timeline?project=${project}&zoom=day&q=${encodeURIComponent(PREFIX)}`);
  const bar = page.getByTestId(`gantt-bar-${task.reference}`);
  await expect(bar).toBeVisible();
  const box = (await bar.boundingBox())!;
  await drag(page, bar, { x: box.x + box.width / 2 + 2 * 40 + 6, y: box.y + box.height / 2 });
  await expect(page.getByText(new RegExp(`${task.reference} now runs`))).toBeVisible();
  await expect.poll(async () => String(await fieldOf(task.id, "start_date")).slice(0, 10)).toBe(day(4));
  expect(String(await fieldOf(task.id, "due_date")).slice(0, 10)).toBe(day(6));
});

test("a dependency is drawn from one bar's end to another", async ({ page }) => {
  const first = await makeTask("first", 1, 2);
  const second = await makeTask("second", 5, 7);
  await page.goto(`/timeline?project=${project}&zoom=day&q=${encodeURIComponent(PREFIX)}`);
  const source = page.getByTestId(`gantt-bar-${first.reference}`);
  await source.hover();
  const connector = page.getByTestId(`gantt-connector-${first.reference}`);
  const target = (await page.getByTestId(`gantt-bar-${second.reference}`).boundingBox())!;
  await drag(page, connector, { x: target.x + target.width / 2, y: target.y + target.height / 2 });
  await expect(page.getByText(`${second.reference} now waits on ${first.reference}`)).toBeVisible();
  const plan = await (await api.get(endpoint(`/tasks/${second.id}/planning`))).json();
  expect(plan.blocked_by.map((item: { id: string }) => item.id)).toContain(first.id);
});

test("a backlog item dragged into a sprint joins it", async ({ page }) => {
  const made = await api.post(endpoint("/work/sprints"), { data: { project_id: project, name: `${PREFIX} sprint` } });
  expect(made.status()).toBe(201);
  const sprint = (await made.json()) as { id: string; name: string };
  sprints.push(sprint.id);
  const task = await makeTask("plan me", 10, 12);

  await page.goto(`/sprints?project=${project}`);
  const backlog = page.getByTestId("backlog");
  await backlog.getByRole("searchbox", { name: "Search the backlog" }).fill(`${PREFIX} plan me`);
  const item = page.getByTestId(`plan-item-${task.reference}`);
  await expect(item).toBeVisible();
  const list = page.getByTestId(`sprint-${sprint.name}`).locator("[data-drop-list]");
  const box = (await list.boundingBox())!;
  await drag(page, item, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(page.getByTestId(`sprint-${sprint.name}`).getByTestId(`plan-item-${task.reference}`)).toBeVisible();
  await expect.poll(async () => {
    const detail = await (await api.get(endpoint(`/work/sprints/${sprint.id}`))).json();
    return detail.tasks.map((item: { id: string }) => item.id);
  }).toContain(task.id);
});

test("the burndown and velocity draw from the seeded history", async ({ page }) => {
  const running = await (await api.get(endpoint("/work/sprints"), { params: { state: "ACTIVE" } })).json();
  test.skip(running.items.length === 0, "no running sprint seeded — run --sync-planning");
  await page.goto(`/sprints?project=${running.items[0].project.id}&tab=reports`);
  await expect(page.getByTestId("burndown-chart").locator("canvas")).toBeVisible();
  await expect(page.getByTestId("velocity-chart").locator("canvas")).toBeVisible();
});
