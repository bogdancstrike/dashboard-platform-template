// The Keycloak sign-in page, in a fresh context (no session): each width and
// appearance, probes + axe, then a wrong password and the "forgot" link.
//   node e2e/audit-b/login.mjs
import path from "node:path";
import { chromium } from "playwright";
import { BASE, SHOTS, SIZES, axe, probe, watch } from "./lib.mjs";

const browser = await chromium.launch();
for (const device of ["pc", "phone"]) {
  for (const theme of ["light", "dark"]) {
    const [w, h] = SIZES[device];
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: theme });
    const page = await ctx.newPage();
    const log = watch(page);
    await page.goto(BASE + "/home");
    await page.waitForSelector("#username", { timeout: 60_000 });
    await page.waitForTimeout(800);
    const geo = await probe(page);
    const ax = await axe(page);
    await page.screenshot({ path: path.join(SHOTS, `auditB_login_${device}_${theme}.png`) });
    await page.fill("#username", "admin");
    await page.fill("#password", "definitely-wrong");
    await page.click("#kc-login, [type=submit]");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOTS, `auditB_login-wrong_${device}_${theme}.png`) });
    const error = await page.locator("#input-error, .kc-feedback-text, .alert-error, [class*=error]").first().innerText().catch(() => "");
    console.log(JSON.stringify({ device, theme, overflowX: geo.overflowX, small: geo.small.slice(0, 5), clipped: geo.clipped.slice(0, 3), axe: ax.map((v) => `${v.id}(${v.n}): ${v.targets[0]}`), error: error.slice(0, 80), console: log.console.slice(0, 3) }));
    await ctx.close();
  }
}
await browser.close();
