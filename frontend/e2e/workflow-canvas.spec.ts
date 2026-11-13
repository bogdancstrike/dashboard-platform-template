import { expect, test } from "@playwright/test";

import { apiAs, endpoint, sweepAutomations } from "./api";
import { signIn } from "./auth";

/**
 * The visual workflow builder against the real stack (§49): build a workflow on
 * the canvas — drag a step from the palette, wire it in — publish it, switch it
 * on, and see it fire when a record is created.
 */

test.describe.configure({ mode: "serial" });

const made: string[] = [];
test.afterEach(async () => {
  await sweepAutomations(made.splice(0, made.length));
});

test("a workflow built on the canvas is published and fires on a new task", async ({ page }) => {
  const stamp = `E2E canvas ${Date.now()}`;
  await signIn(page, "admin", "/workflows");
  await page.getByTestId("build-on-canvas").click();
  await expect(page).toHaveURL(/\/workflows\/[0-9a-f-]+\/canvas/);
  made.push(page.url().split("/workflows/")[1]!.split("/")[0]!);
  await expect(page.getByTestId("workflow-canvas")).toBeVisible();

  // Name it, so the run is ours to find.
  const name = page.getByLabel("Workflow name");
  await name.fill(stamp);
  await name.blur();

  // Drag "Raise a task" from the palette onto the canvas.
  const before = await page.locator("[data-node-id]").count();
  await page.getByTestId("palette-TASK").dragTo(page.getByTestId("workflow-canvas"), { targetPosition: { x: 420, y: 420 } });
  await expect(page.locator("[data-node-id]")).toHaveCount(before + 1);
  const added = page.locator("[data-node-id^='task']").last();
  const addedId = await added.getAttribute("data-node-id");

  // Wire the notify step to it from the inspector's Next step.
  await page.locator("[data-node-id^='notify']").first().click();
  await page.getByTestId("next-out").click();
  await page.locator(".ant-select-item-option").filter({ hasText: "Raise a task" }).first().click();
  await expect(page.getByTestId(`edge-e-notify1-out-${addedId}`)).toBeAttached();

  // Publish, then switch it on.
  await page.getByTestId("publish-workflow").click();
  await expect(page.getByText(/Published version 2/)).toBeVisible();
  await page.getByTestId("canvas-enabled").click();
  await expect(page.getByText(/is live/)).toBeVisible();

  // A new task fires it.
  const api = await apiAs("admin");
  try {
    const created = await api.post(endpoint("/records/task"), { data: { title: `${stamp} trigger`, priority: "HIGH" } });
    expect(created.status()).toBe(201);
  } finally {
    await api.dispose();
  }
  await page.reload();
  await page.getByText(/History/).click();
  await expect(page.getByTestId("node-trigger")).toContainText("1 in");
});
