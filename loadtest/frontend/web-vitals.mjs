#!/usr/bin/env node
// Lighthouse-style lab metrics for the main pages, with Playwright (docs/testing/performance.md).
//
//   node loadtest/frontend/web-vitals.mjs [base-url]      # default http://localhost:8090 (the stable Nucleus production build)
//
// Each page is opened cold (a fresh browser context: empty HTTP cache, signed
// in from a saved storage state) on a desktop viewport, and measured in-page
// with the same browser APIs Lighthouse reads:
//   FCP, LCP (largest-contentful-paint), CLS (layout-shift), TBT (sum of each
//   long task's time past 50 ms between FCP and settle), plus the JavaScript
//   bytes transferred.
// Budgets: LCP <= 2500 ms and TBT <= 300 ms ("good" in Lighthouse's desktop
// scoring is LCP <= 1.2 s, TBT <= 150 ms — the budget is the threshold for a
// regression, not the goal). Optional CPU throttling: THROTTLE=4.
// Writes a JSON next to the HTML/CSV reports: loadtest/reports/web-vitals.json.
import { chromium } from "../../frontend/node_modules/playwright/index.mjs";
import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:8090";
const ROUTES = (process.env.ROUTES ?? "/home,/dashboard,/tasks,/tickets,/explore,/kanban,/files,/find/global,/admin/audit,/notifications").split(",");
const THROTTLE = Number(process.env.THROTTLE ?? 1);
const BUDGET = { lcp: Number(process.env.BUDGET_LCP_MS ?? 2500), tbt: Number(process.env.BUDGET_TBT_MS ?? 300) };
const reports = join(here, "..", "reports");
mkdirSync(reports, { recursive: true });
const STATE = join(reports, ".web-vitals-auth.json");

const browser = await chromium.launch();

async function signIn() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/home`);
  for (let i = 0; i < 120; i++) {
    if (await page.locator(".nx-app").count()) break;
    if (await page.locator("#username").count()) {
      await page.fill("#username", process.env.PERSONA ?? "admin");
      await page.fill("#password", process.env.PERSONA ?? "admin");
      await page.click("#kc-login, [type=submit]");
      await page.waitForTimeout(1500);
    }
    await page.waitForTimeout(500);
  }
  await ctx.storageState({ path: STATE });
  await ctx.close();
}

if (!existsSync(STATE) || Date.now() - statSync(STATE).mtimeMs > 15 * 60_000) await signIn();

const OBSERVE = () => {
  window.__vitals = { lcp: 0, cls: 0, longtasks: [] };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__vitals.lcp = Math.max(window.__vitals.lcp, e.renderTime || e.loadTime || e.startTime);
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
  }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) window.__vitals.longtasks.push([e.startTime, e.duration]);
  }).observe({ type: "longtask", buffered: true });
};

const rows = [];
for (const route of ROUTES) {
  const ctx = await browser.newContext({ storageState: STATE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  if (THROTTLE > 1) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  }
  await page.addInitScript(OBSERVE);
  let jsBytes = 0;
  page.on("response", async (res) => {
    if (res.url().endsWith(".js") || res.request().resourceType() === "script") {
      // Bytes on the wire (gzip), as Lighthouse's "transfer size" counts them.
      const sizes = await res.request().sizes().catch(() => null);
      jsBytes += sizes ? sizes.responseBodySize : 0;
    }
  });
  await page.goto(`${BASE}${route}`, { waitUntil: "load" });
  if (await page.locator("#username").count()) {
    await signIn();
    await page.goto(`${BASE}${route}`, { waitUntil: "load" });
  }
  await page.waitForSelector(".nx-app", { timeout: 30_000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    const tbt = window.__vitals.longtasks
      .filter(([start]) => start >= fcp)
      .reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0);
    return { ttfb: nav?.responseStart ?? 0, fcp, lcp: window.__vitals.lcp, cls: window.__vitals.cls, tbt };
  });
  const row = { route, ...Object.fromEntries(Object.entries(m).map(([k, v]) => [k, k === "cls" ? +v.toFixed(3) : Math.round(v)])),
    js_kb: Math.round(jsBytes / 1024) };
  row.ok = row.lcp <= BUDGET.lcp && row.tbt <= BUDGET.tbt;
  rows.push(row);
  console.log(`${row.ok ? "ok  " : "OVER"} ${route.padEnd(14)} TTFB ${String(row.ttfb).padStart(5)}  FCP ${String(row.fcp).padStart(5)}  LCP ${String(row.lcp).padStart(5)}  TBT ${String(row.tbt).padStart(4)}  CLS ${row.cls}  JS ${row.js_kb} kB`);
  await ctx.close();
}
await browser.close();
writeFileSync(join(reports, "web-vitals.json"), JSON.stringify({ base: BASE, throttle: THROTTLE, budget: BUDGET, rows }, null, 1));
process.exit(rows.every((r) => r.ok) ? 0 : 1);
