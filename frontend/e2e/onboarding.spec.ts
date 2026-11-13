import { expect, test } from "@playwright/test";

import { signIn } from "./auth";

/** Getting started (§38): a checklist step, and sample data on and off. */

test.describe.configure({ mode: "serial" });

test("a checklist step is marked done and back", async ({ page }) => {
  await signIn(page, "admin", "/onboarding");
  const step = page.getByTestId("step-tour");
  await expect(step).toBeVisible();
  if (await page.getByTestId("undo-tour").count()) await page.getByTestId("undo-tour").click();
  await page.getByTestId("done-tour").click();
  await expect(step).toContainText("Marked done");
  await page.getByTestId("undo-tour").click();
  await expect(page.getByTestId("done-tour")).toBeVisible();
});

test("sample data loads tagged and is removed again", async ({ page }) => {
  await signIn(page, "admin", "/onboarding");
  const devices = page.getByTestId("sample-devices");
  if (await page.getByTestId("remove-sample-devices").count()) {
    await page.getByTestId("remove-sample-devices").click();
    await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  }
  await page.getByTestId("load-sample-devices").click();
  await expect(devices).toContainText("6 sample");
  await page.getByTestId("remove-sample-devices").click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByTestId("load-sample-devices")).toBeVisible();
});
