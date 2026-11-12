/**
 * The AI assistant end to end (§41–46), against the running stack.
 *
 * Every request carries `X-Nucleus-LLM: fake`: with LLM_ALLOW_FAKE_HEADER=true
 * on the API (the e2e/load profile) the deterministic fake answers and no
 * tokens are spent. Without it the real model answers, capped by
 * LLM_MAX_SECONDS — so the assertions here are about the product's behaviour,
 * never about the words a model chose.
 */
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Only on the API's own requests: sent everywhere, the header would also
  // reach the identity provider, whose CORS rules have never heard of it.
  await page.route("**/platform/api/assistant/**", (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-nucleus-llm": "fake" } }),
  );
});

test("a conversation is created, answered, kept, renamed and deleted", async ({ page }) => {
  await page.goto("/assistant");
  await expect(page.getByTestId("assistant-chat")).toBeVisible();
  await page.getByTestId("assistant-input").fill("E2E: say hello in five words");
  await page.getByTestId("assistant-input").press("Enter");
  await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]{36}$/, { timeout: 45_000 });
  await expect(page.getByTestId("assistant-message").last()).toBeVisible();

  const row = page.getByTestId("assistant-conversation").filter({ hasText: "E2E: say hello" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Title").fill("E2E renamed");
  await page.getByRole("button", { name: "Rename" }).click();
  const renamed = page.getByTestId("assistant-conversation").filter({ hasText: "E2E renamed" });
  await expect(renamed).toBeVisible();

  await renamed.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await expect(renamed).toHaveCount(0);
  await expect(page).toHaveURL(/\/assistant$/);
});

test("Data mode answers with lookups", async ({ page }) => {
  await page.goto("/assistant");
  await page.getByTestId("assistant-mode").getByText("Data").click();
  await page.getByTestId("assistant-input").fill("E2E: how many open tickets are there?");
  await page.getByTestId("assistant-input").press("Enter");
  await expect(page).toHaveURL(/\/assistant\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  await expect(page.getByText(/Used \d+ lookup/)).toBeVisible();
  // Clean up after ourselves.
  const row = page.getByTestId("assistant-conversation").filter({ hasText: "E2E: how many" }).first();
  await row.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
});

test("a description becomes rules in the explorer's builder", async ({ page }) => {
  await page.goto("/explore?resource=ticket&panel=rules");
  await page.getByTestId("describe-input").fill("open critical tickets");
  await page.getByTestId("describe-go").click();
  await expect(page.getByTestId("describe-result")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("run-advanced-search").or(page.getByRole("button", { name: /Search/ })).first()).toBeVisible();
});

test("Home carries the brief, Help answers about the page, ⌘J opens the panel", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByTestId("daily-brief")).toBeVisible();
  await expect(page.getByTestId("brief-headline")).toBeVisible({ timeout: 45_000 });

  await page.goto("/tasks");
  await page.locator('[data-testid="page-tour"]:visible').first().click();
  await expect(page.getByTestId("help-panel")).toBeVisible();
  await page.getByTestId("page-ask-input").fill("How do I create a task?");
  await page.getByTestId("page-ask-go").click();
  await expect(page.getByTestId("page-ask-answer")).toBeVisible({ timeout: 45_000 });
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+j");
  await expect(page.getByTestId("assistant-chat")).toBeVisible();
});
