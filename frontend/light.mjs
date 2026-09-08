import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const context = await browser.newContext({ storageState: ".auth/admin.json", viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
await page.goto("http://localhost:5174/dashboard");
await page.waitForLoadState("networkidle");
const theme = await page.locator("html").getAttribute("data-theme");
if (theme === "dark") {
  await page.getByRole("button", { name: /Open the command palette/ }).click();
  await page.getByText("Switch to the light theme", { exact: true }).click();
  await page.waitForTimeout(1200);
}
console.log("theme now", await page.locator("html").getAttribute("data-theme"));
await browser.close();
