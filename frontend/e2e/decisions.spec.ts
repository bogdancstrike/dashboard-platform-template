import { expect, test, type Browser, type Page } from "@playwright/test";

import { apiAs, endpoint, namespaced } from "./api";
import { storageStateFor, type Persona } from "./auth";

/**
 * Time & decisions against the real stack: a timer that survives the header,
 * a week that is submitted and approved, a forbidden page that becomes an
 * access request and then a permission, an SLA policy edit reaching a ticket,
 * and a public form that becomes a ticket without anybody signing in.
 *
 * Each test cleans up through the API a person would use, except what the
 * product deliberately keeps (an approved timesheet is history).
 */

test.describe.configure({ mode: "serial" });

async function pageAs(browser: Browser, persona: Persona): Promise<Page> {
  const context = await browser.newContext({ storageState: storageStateFor(persona) });
  return context.newPage();
}

test("a timer started on a task runs in the header and stops into an entry", async ({ browser }) => {
  const api = await apiAs("operator");
  await api.post(endpoint("/time/timer/stop"), { data: {} });
  const tasks = await (await api.post(endpoint("/explorer/query"), {
    data: { resource_type: "task", columns: ["reference", "title"], page_size: 1 },
  })).json() as { items: { id: string }[] };
  const taskId = tasks.items[0]!.id;

  const page = await pageAs(browser, "operator");
  await page.goto(`/tasks/${taskId}`);
  await page.getByTestId("record-timer").click();
  await expect(page.getByTestId("record-timer")).toContainText("Stop");
  await expect(page.getByTestId("timer-clock")).toBeVisible();

  // Another page: the header still knows.
  await page.goto("/home");
  await expect(page.getByTestId("timer-clock")).toHaveText(/\d:\d\d:\d\d/);
  await page.getByTestId("timer-pill").click();
  await page.getByLabel("Note for this time").fill("e2e timer");
  await page.getByTestId("timer-stop").click();
  await expect(page.getByTestId("timer-pill")).toHaveAccessibleName("Start a timer");

  const entries = await (await api.get(endpoint(`/time/entries?subject_id=${taskId}&page_size=5`))).json() as {
    items: { id: string; note: string; minutes: number }[];
  };
  const made = entries.items.find((item) => item.note === "e2e timer");
  expect(made?.minutes).toBeGreaterThanOrEqual(1);
  await api.delete(endpoint(`/time/entries/${made!.id}`));
  await page.context().close();
});

test("a submitted week is locked, approved by the manager, and closed", async ({ browser }) => {
  const api = await apiAs("operator");
  // A week in the past nobody has submitted: one per run.
  const monday = new Date(Date.UTC(2019, 0, 7 + 7 * Math.floor(Math.random() * 150)));
  const week = monday.toISOString().slice(0, 10);
  const subjects = await (await api.get(endpoint("/time/subjects?q=a"))).json() as {
    items: { subject_type: string; subject_id: string }[];
  };
  const subject = subjects.items[0]!;
  await api.post(endpoint("/time/entries"), {
    data: { subject_type: subject.subject_type, subject_id: subject.subject_id, work_date: week, minutes: 150, note: "e2e week" },
  });

  const operator = await pageAs(browser, "operator");
  await operator.goto(`/time?week=${week}`);
  await expect(operator.getByTestId("week-total")).toHaveText("2h 30m");
  await operator.getByTestId("week-submit").click();
  await operator.getByRole("dialog").getByRole("button", { name: "Submit week" }).click();
  await expect(operator.getByTestId("week-locked")).toContainText("locked");

  const sheet = await (await api.get(endpoint(`/time/week?week=${week}`))).json() as { timesheet: { approval_id: string } };
  const manager = await pageAs(browser, "manager");
  await manager.goto(`/approvals?open=${sheet.timesheet.approval_id}`);
  const drawer = manager.getByTestId("approval-drawer");
  await expect(drawer.getByTestId("approval-title")).toContainText("Timesheet");
  await drawer.getByTestId("approval-approve").click();
  await expect(drawer).toContainText("approved");

  await operator.reload();
  await expect(operator.getByTestId("week-status")).toHaveText("Approved");
  await operator.context().close();
  await manager.context().close();
});

test("asking for access from a forbidden page, approved, opens the page", async ({ browser }) => {
  const viewer = await pageAs(browser, "viewer");
  await viewer.goto("/admin/logs");
  await viewer.getByTestId("problem-ask-access").click();
  await viewer.getByLabel("Reason").fill("e2e: I read logs for incidents");
  await viewer.getByRole("button", { name: "Send request" }).click();
  await expect(viewer.getByTestId("problem-access-sent")).toBeVisible();

  const admin = await apiAs("admin");
  const inbox = await (await admin.get(endpoint("/approvals?scope=inbox&kind=access&q=system logs"))).json() as {
    items: { id: string; requester: { name: string } }[];
  };
  const request = inbox.items.find((item) => item.requester.name === "Uma User")!;
  const adminPage = await pageAs(browser, "admin");
  await adminPage.goto(`/approvals?open=${request.id}`);
  await adminPage.getByTestId("approval-approve").click();
  await expect(adminPage.getByTestId("approval-drawer")).toContainText("approved");

  await viewer.goto("/admin/logs");
  await expect(viewer.getByTestId("problem-forbidden")).toHaveCount(0);

  // Take the grant back, so the persona is a viewer again.
  const groups = await (await admin.get(namespaced("/admin/groups?q=Access"))).json() as { items: { id: string; name: string }[] };
  const group = groups.items.find((item) => item.name.includes("system logs"));
  if (group) await admin.put(namespaced(`/admin/groups/${group.id}/members`), { data: { user_ids: [] } });
  await viewer.context().close();
  await adminPage.context().close();
});

test("tightening an SLA policy brings a ticket's deadline forward", async ({ browser }) => {
  const admin = await apiAs("admin");
  const tickets = await (await admin.post(endpoint("/explorer/query"), {
    data: { resource_type: "ticket", filters: { status: "OPEN" }, columns: ["reference", "priority", "customer_id"], page_size: 1 },
  })).json() as { items: { id: string; priority: string; customer_id: string }[] };
  const ticket = tickets.items[0]!;
  const made = await (await admin.post(endpoint("/sla/policies"), {
    data: { name: "e2e policy", conditions: { customer_ids: [ticket.customer_id] },
            targets: { [ticket.priority]: { first_response: 60, resolution: 6000 } } },
  })).json() as { id: string };
  const overview = await (await admin.get(endpoint("/sla/policies"))).json() as { items: { id: string }[] };
  await admin.put(endpoint("/sla/policies/order"), { data: { ids: [made.id, ...overview.items.map((p) => p.id).filter((id) => id !== made.id)] } });

  try {
    const page = await pageAs(browser, "admin");
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByTestId("ticket-sla-policy")).toHaveText("e2e policy");
    const before = await (await admin.get(endpoint(`/sla/tickets/${ticket.id}`))).json() as { resolution: { due_at: string } };

    await page.goto(`/admin/sla?policy=${made.id}`);
    const drawer = page.getByTestId("sla-drawer");
    const field = drawer.getByLabel(`${ticket.priority} resolution hours`);
    await field.fill("2");
    await drawer.getByTestId("sla-save").click();
    await expect(drawer).toBeHidden();

    const after = await (await admin.get(endpoint(`/sla/tickets/${ticket.id}`))).json() as { resolution: { due_at: string } };
    expect(new Date(after.resolution.due_at).valueOf()).toBeLessThan(new Date(before.resolution.due_at).valueOf());
    await page.goto(`/tickets/${ticket.id}`);
    await expect(page.getByTestId("ticket-sla")).toContainText("resolve within 2h");
    await page.context().close();
  } finally {
    await admin.delete(endpoint(`/sla/policies/${made.id}`));
  }
});

test("a public form answered without signing in becomes a ticket", async ({ browser }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/f/support");
  await expect(page.getByRole("heading", { name: "Customer support request" })).toBeVisible();
  const marker = `e2e form ${Date.now()}`;
  await page.getByRole("textbox", { name: "Your name" }).fill("Dana Example");
  await page.getByRole("textbox", { name: "Work email" }).fill("dana@example.com");
  await page.getByRole("textbox", { name: "What is going wrong?" }).fill(marker);
  await page.getByRole("combobox", { name: "Area" }).click();
  await page.locator(".ant-select-item-option", { hasText: "Billing" }).click();
  const question = await page.locator("label", { hasText: "What is" }).last().innerText();
  const [a, b] = (question.match(/\d+/g) ?? ["0", "0"]).map(Number);
  await page.getByTestId("form-captcha").fill(String(a! + b!));
  await page.getByTestId("form-submit").click();
  await expect(page.getByTestId("public-form-done")).toContainText("SUB-");
  await context.close();

  const admin = await apiAs("admin");
  const forms = await (await admin.get(endpoint("/forms"))).json() as { items: { id: string; slug: string }[] };
  const form = forms.items.find((item) => item.slug === "support")!;
  const subs = await (await admin.get(endpoint(`/forms/${form.id}/submissions`))).json() as {
    items: { status: string; record_type: string; record_id: string; answers: { value: unknown }[] }[];
  };
  const mine = subs.items.find((item) => item.answers.some((answer) => answer.value === marker))!;
  expect(mine.status).toBe("CONVERTED");
  expect(mine.record_type).toBe("ticket");
  const ticket = await (await admin.get(endpoint(`/records/ticket/${mine.record_id}`))).json() as { title: string };
  expect(ticket.title).toBe(marker);
  await admin.delete(endpoint(`/records/ticket/${mine.record_id}`));
});
