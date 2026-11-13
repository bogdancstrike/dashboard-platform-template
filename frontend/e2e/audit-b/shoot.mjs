// Screenshot routes on one device/theme, and report table fit on each.
//   BASE_URL=... node e2e/audit-b/shoot.mjs <prefix> <pc|tablet|phone> <light|dark> /route ...
import path from "node:path";
import { BASE, SHOTS, context, launch, settle, slug } from "./lib.mjs";

const [prefix, device = "pc", theme = "light", ...routes] = process.argv.slice(2);
const browser = await launch();
const ctx = await context(browser, { device, theme });
const page = await ctx.newPage();
for (const r of routes) {
  await page.goto(BASE + r);
  await page.waitForSelector("#nu-main, form, main", { timeout: 60_000 }).catch(() => undefined);
  await settle(page, 1200);
  const fit = await page.$$eval(".ant-table-content, .ant-table-body", (els) =>
    els.map((e) => `${e.scrollWidth}/${e.clientWidth}`),
  );
  const out = path.join(SHOTS, `auditB_${prefix}_${slug(r)}_${device}_${theme}.png`);
  await page.screenshot({ path: out });
  console.log(out, "tables:", fit.join(" "));
}
await browser.close();
