import { expect, test, type Page } from "@playwright/test";

import { apiAs, endpoint, namespaced } from "./api";
import { signIn, storageStateFor } from "./auth";

/**
 * Collaboration (§47–49), end to end against the running stack: a message
 * with a mention and a reaction, a line delivered live to a second person,
 * presence, a wiki page with blocks and a linked record, and meeting notes
 * whose action item becomes a real task.
 *
 * Each test makes its own channel, page or event and removes it afterwards,
 * so the seeded demo data is what the rest of the suite measures.
 */

test.describe.configure({ mode: "serial" });

const made = { channels: [] as string[], pages: [] as string[], events: [] as string[], tasks: [] as string[] };

async function userId(username: string): Promise<string> {
  const api = await apiAs("admin");
  try {
    const found = await api.get(endpoint(`/directory/people?q=${username}`));
    const body = (await found.json()) as { items: Array<{ id: string; username: string }> };
    return body.items.find((person) => person.username === username)!.id;
  } finally {
    await api.dispose();
  }
}

async function scratchChannel(): Promise<string> {
  const api = await apiAs("admin");
  try {
    const manager = await userId("manager");
    const created = await api.post(endpoint("/chat/channels"), {
      data: { name: `e2e-${Date.now()}`, topic: "Playwright", member_ids: [manager] },
    });
    expect(created.status()).toBe(201);
    const channel = (await created.json()) as { id: string };
    made.channels.push(channel.id);
    return channel.id;
  } finally {
    await api.dispose();
  }
}

async function composer(page: Page) {
  return page.getByTestId("chat-composer").getByRole("textbox");
}

test.afterAll(async () => {
  const api = await apiAs("admin");
  try {
    for (const id of made.channels) await api.delete(endpoint(`/chat/channels/${id}`));
    for (const id of made.pages) await api.delete(endpoint(`/docs/pages/${id}`));
    for (const id of made.tasks) await api.delete(endpoint(`/records/task/${id}`));
    for (const id of made.events) await api.delete(endpoint(`/calendar/events/${id}`));
  } finally {
    await api.dispose();
  }
});

test("a message with a mention and a reaction", async ({ page }) => {
  const id = await scratchChannel();
  await signIn(page, "admin", `/chat/${id}`);
  const box = await composer(page);
  await box.click();
  await box.pressSequentially("Can you review this @Mar");
  await page.getByRole("option", { name: /Mara Manager/ }).click();
  await box.pressSequentially("please");
  await box.press("Enter");

  const line = page.getByTestId("chat-messages").locator(".nx-co-msg").filter({ hasText: "Can you review this" });
  await expect(line).toBeVisible();
  await expect(line.locator(".nx-co-mention")).toHaveText("@Mara Manager");

  await line.hover();
  await line.getByLabel("Add a reaction").click();
  await page.getByLabel("React 🎉").click();
  await expect(line.getByLabel("🎉 1")).toHaveAttribute("aria-pressed", "true");

  // The mention reached Mara as a notification that opens this channel.
  const api = await apiAs("manager");
  try {
    const listed = await api.get(namespaced("/notifications?category=MENTION"));
    const body = (await listed.json()) as { items: Array<{ link: string }> };
    expect(body.items.some((item) => item.link === `/chat/${id}`)).toBe(true);
  } finally {
    await api.dispose();
  }
});

test("a line arrives live in another person's browser, with typing and presence", async ({ page, browser }) => {
  const id = await scratchChannel();
  const other = await browser.newContext({ storageState: storageStateFor("manager") });
  const mara = await other.newPage();
  try {
    await signIn(mara, "manager", `/chat/${id}`);
    await expect(mara.getByTestId("chat-head")).toBeVisible();

    await signIn(page, "admin", `/chat/${id}`);
    // Presence: Mara has the app open, so her dot is green in the members list.
    await page.getByTestId("chat-members").click();
    const members = page.getByTestId("channel-members");
    await expect(members.locator("li").filter({ hasText: "Mara Manager" }).locator('[data-presence="online"]')).toBeVisible();
    await page.keyboard.press("Escape");

    const box = await composer(page);
    await box.click();
    await box.pressSequentially("Live from Ada");
    await expect(mara.getByTestId("typing")).toContainText("Ada is typing");
    await box.press("Enter");

    // No reload on Mara's side: the socket's hint made her page re-read.
    await expect(mara.getByTestId("chat-messages").getByText("Live from Ada")).toBeVisible({ timeout: 15_000 });
  } finally {
    await other.close();
  }
});

test("a wiki page with blocks, linked to a record", async ({ page }) => {
  await signIn(page, "admin", "/docs");
  await page.getByTestId("new-page").click();
  const title = `Playwright page ${Date.now()}`;
  await page.getByLabel("Page title").fill(title);
  await page.getByTestId("template-blank").click();
  await page.getByTestId("create-page").click();
  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}\?edit=1/);
  made.pages.push(new URL(page.url()).pathname.split("/").pop()!);

  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Written by **Playwright**.");
  await page.getByTestId("add-block").click();
  await page.getByRole("menuitem", { name: /Checklist/ }).click();
  await page.getByLabel("Checklist item 1").fill("Check the release notes");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });

  await page.getByTestId("toggle-edit").click();
  const body = page.getByTestId("doc-body");
  await expect(body.getByText("Playwright", { exact: true })).toBeVisible();
  await expect(body.getByText("Check the release notes")).toBeVisible();

  await page.getByTestId("link-record").click();
  await page.getByTestId("record-search").fill("an");
  const first = page.locator(".nx-dc-picker button").first();
  await expect(first).toBeVisible();
  await first.click();
  // Linked by hand: one row in the side card, marked as such.
  const links = page.getByTestId("doc-links").locator("li");
  await expect(links).toHaveCount(1);
  await expect(links.first()).toContainText("linked");

  // Search finds the page by its title.
  await page.goto(`/docs?q=${encodeURIComponent(title)}`);
  await expect(page.getByTestId("docs-results").getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test("meeting notes: an action item becomes a task", async ({ page }) => {
  const day = new Date(Date.now() + 2 * 86_400_000);
  const on = day.toISOString().slice(0, 10);
  const title = `Playwright meeting ${Date.now()}`;
  const api = await apiAs("admin");
  try {
    const created = await api.post(endpoint("/calendar/events"), {
      data: {
        title,
        description: "Pricing\nRenewal",
        category: "MEETING",
        starts_at: `${on}T10:00:00Z`,
        ends_at: `${on}T11:00:00Z`,
      },
    });
    expect(created.ok()).toBe(true);
    made.events.push(((await created.json()) as { id?: string; event_id?: string }).event_id ?? "");
  } finally {
    await api.dispose();
  }

  await signIn(page, "admin", `/calendar?view=week&on=${on}`);
  await page.locator(".nu-event-chip").filter({ hasText: title }).first().click();
  await page.getByTestId("take-notes").click();
  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}\?edit=1/);
  made.pages.push(new URL(page.url()).pathname.split("/").pop()!);

  await expect(page.getByTestId("doc-title")).toHaveValue(new RegExp(title));
  await page.getByLabel("Action item").fill("Send the renewal draft");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });
  await page.getByTestId("toggle-edit").click();

  await page.getByTestId("create-task").click();
  const task = page.getByTestId("action-task");
  await expect(task).toContainText("TSK-");
  await expect(task).toContainText(/New/i);
  const href = await task.getAttribute("href");
  made.tasks.push(href!.split("/").pop()!);
  await expect(page.getByTestId("doc-meeting")).toContainText(title);
});
