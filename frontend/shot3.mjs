import { chromium } from "@playwright/test";
const [, , path, out, clickTestId] = process.argv;
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: ".auth/admin.json", viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto(`http://localhost:5174${path}`);
await page.waitForLoadState("networkidle");
await page.waitForTimeout(1200);
if (clickTestId) {
  await page.locator(clickTestId).first().click();
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
await browser.close();
