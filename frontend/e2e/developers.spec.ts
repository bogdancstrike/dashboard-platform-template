import { expect, test } from "@playwright/test";

import { signIn } from "./auth";

/** The developer portal (§31): find an endpoint, try it, read the answer. */

test("the reference finds an endpoint and the console calls it", async ({ page }) => {
  await signIn(page, "admin", "/developers");
  await page.getByLabel("Search endpoints").fill("explorer/catalog");
  await page.getByTestId("endpoint-GET /api/explorer/catalog").click();
  await expect(page.getByTestId("endpoint-detail")).toContainText("/platform/api/explorer/catalog");
  await expect(page.getByTestId("request-snippet")).toContainText("curl -X GET");
  await page.getByTestId("try-endpoint").click();
  await expect(page).toHaveURL(/\/developers\/console\?endpoint=/);
  await page.getByTestId("console-send").click();
  await expect(page.getByTestId("console-status")).toHaveText("200");
  await expect(page.getByTestId("console-body")).toContainText('"items"');
});

test("usage is charted per API client", async ({ page }) => {
  await signIn(page, "admin", "/developers/usage");
  await expect(page.getByTestId("kpi-requests")).toBeVisible();
  await expect(page.getByTestId("usage-clients")).toBeVisible();
});
