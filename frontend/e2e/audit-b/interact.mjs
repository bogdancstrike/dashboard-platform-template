// Generic "use every control" crawl. For each route: every visible button,
// tab, segmented option, select, switch-free toggle and menu trigger inside
// #nu-main is clicked in turn; whatever it opens (modal, drawer, dropdown,
// select list, popover, navigation) is screenshotted, probed, axe-checked
// (modal/drawer), then dismissed with Escape — and if Escape does not close it,
// that is a finding, and the × is tried. Mutating verbs are skipped here; the
// scripted flows (flows.mjs) exercise those on throwaway data.
//   node e2e/audit-b/interact.mjs [--device pc] [--theme light] [--only /admin] [--max 40]
import fs from "node:fs";
import path from "node:path";
import { BASE, OUT, SHOTS, axe, context, launch, probe, settle, slug, watch, ensureLogin } from "./lib.mjs";
import { ROUTES, resolveIds } from "./routes.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const device = opt("device", "pc");
const theme = opt("theme", "light");
const persona = opt("persona", "admin");
const only = opt("only", "");
const max = Number(opt("max", "45"));
const conc = Number(opt("conc", "3"));

const MUTATING =
  /\b(delete|remove|revoke|disable|deactivate|reset|sign ?out|log ?out|impersonat|rotate|purge|archive|restore|run now|retry|kill|terminate|approve|reject|send|publish|submit|save|apply|import|upload|merge|unlink|leave|suspend|lock|unlock|regenerate|clear all|mark all|block|enable|start|stop|pause|resume|end session|end all|discard|post|reply|duplicate|copy link|share|follow|unfollow|invite|add|test)\b/i;

const OVERLAYS = {
  modal: ".ant-modal-wrap:not([style*='display: none']) .ant-modal",
  drawer: ".ant-drawer-open .ant-drawer-content-wrapper",
  dropdown: ".ant-dropdown:not(.ant-dropdown-hidden)",
  select: ".ant-select-dropdown:not(.ant-select-dropdown-hidden)",
  picker: ".ant-picker-dropdown:not(.ant-picker-dropdown-hidden)",
  popover: ".ant-popover:not(.ant-popover-hidden)",
  popconfirm: ".ant-popconfirm:not(.ant-popover-hidden)",
};

async function openOverlays(page) {
  const found = [];
  for (const [k, sel] of Object.entries(OVERLAYS)) {
    const n = await page.locator(sel).filter({ visible: true }).count().catch(() => 0);
    if (n) found.push(k);
  }
  return found;
}

const browser = await launch();
await ensureLogin(browser, persona);
const ids = await resolveIds(browser, persona);
const routes = ROUTES(ids).filter((r) => (!only || only.split(",").some((o) => r.startsWith(o))) && !r.startsWith("/errors") && r !== "/no-such-page");
const findings = [];
const queue = [...routes];

async function crawl(ctx, route) {
  const page = await ctx.newPage();
  const log = watch(page);
  const items = [];
  const load = async () => {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#nu-main, form", { timeout: 45_000 }).catch(() => undefined);
    await settle(page, 500);
  };
  await load();
  // Labels of every candidate, read once; each is re-found by index on a fresh state.
  const SEL =
    "#nu-main button:not([disabled]), #nu-main [role=tab], #nu-main .ant-segmented-item:not(.ant-segmented-item-selected), #nu-main .ant-select:not(.ant-select-disabled) .ant-select-selector, #nu-main .ant-picker:not(.ant-picker-disabled), #nu-main [role=button]:not(button), #nu-main .ant-dropdown-trigger, #nu-main a[href^='#']";
  const labelOf = (el) =>
    (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.getAttribute("data-testid") || "").trim().replace(/\s+/g, " ").slice(0, 50);
  const labels = await page.$$eval(SEL, (els, fn) => els.map((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? (el.getAttribute("aria-label") || el.getAttribute("title") || el.innerText || el.getAttribute("data-testid") || el.className || "").toString().trim().replace(/\s+/g, " ").slice(0, 50) : null;
  }), labelOf.toString());
  const seen = new Set();
  let n = 0;
  for (let i = 0; i < labels.length && n < max; i++) {
    const label = labels[i];
    if (label === null || seen.has(label) || MUTATING.test(label)) continue;
    seen.add(label);
    n++;
    const errsBefore = log.console.length + log.pageErrors.length;
    const loc = page.locator(SEL).nth(i);
    const urlBefore = page.url();
    const item = { label, opened: [], issues: [] };
    try {
      if (!(await loc.isVisible())) {
        item.issues.push("not visible on fresh state");
        items.push(item);
        continue;
      }
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => undefined);
      await loc.click({ timeout: 4000 });
    } catch (e) {
      item.issues.push(`click failed: ${String(e.message).split("\n")[0].slice(0, 140)}`);
      items.push(item);
      continue;
    }
    await page.waitForTimeout(700);
    item.opened = await openOverlays(page);
    if (page.url() !== urlBefore) item.navigated = page.url().replace(BASE, "");
    if (item.opened.length || item.navigated) {
      const shot = `auditB_ix_${slug(route)}_${slug(label).slice(0, 40)}_${device}_${theme}.png`;
      await page.screenshot({ path: path.join(SHOTS, shot) }).catch(() => undefined);
      item.shot = shot;
      const geo = await probe(page).catch(() => null);
      if (geo) {
        if (geo.overflowX) item.issues.push(`overflowX ${geo.overflowX}`);
        if (geo.offscreen.length) item.issues.push(`offscreen: ${geo.offscreen.slice(0, 3).join(" | ")}`);
        if (geo.clipped.length) item.issues.push(`clipped: ${geo.clipped.slice(0, 3).join(" | ")}`);
      }
      if (item.opened.some((o) => o === "modal" || o === "drawer")) {
        const ax = await axe(page);
        const fresh = ax.filter((v) => v.id !== "region");
        if (fresh.length) item.axe = fresh;
      }
      // Dismiss: Escape first; then × ; then back for navigations.
      if (item.opened.length) {
        await page.keyboard.press("Escape");
        // Close animations run 200-300ms; poll rather than read once.
        let still = await openOverlays(page);
        for (let t = 0; t < 10 && still.length; t++) {
          await page.waitForTimeout(200);
          still = await openOverlays(page);
        }
        if (still.length) {
          item.issues.push(`Escape left open: ${still.join(",")}`);
          await page.locator(".ant-modal-close, .ant-drawer-close").filter({ visible: true }).first().click({ timeout: 1500 }).catch(() => undefined);
          await page.waitForTimeout(400);
          if ((await openOverlays(page)).some((o) => o === "modal" || o === "drawer")) item.issues.push("× did not close either");
        }
      }
      if (page.url() !== urlBefore) {
        await page.goBack().catch(() => undefined);
        await page.waitForTimeout(600);
        if (page.url() !== urlBefore) {
          item.issues.push(`back did not return (at ${page.url().replace(BASE, "")})`);
        }
      }
    }
    const errs = [...log.console, ...log.pageErrors].slice(errsBefore);
    if (errs.length) item.issues.push(...errs.map((e) => `console: ${e.slice(0, 200)}`));
    items.push(item);
    // Fresh state for the next control if anything is still open or we moved.
    if (page.url() !== urlBefore || (await openOverlays(page)).length) await load();
  }
  findings.push({ route, device, theme, persona, items, http: log.http, failed: log.failed });
  await page.close();
}

async function worker() {
  const ctx = await context(browser, { persona, device, theme });
  while (queue.length) {
    const r = queue.shift();
    try {
      await crawl(ctx, r);
    } catch (e) {
      findings.push({ route: r, error: String(e).slice(0, 300) });
    }
    console.log("done", r);
  }
  await ctx.close();
}
await Promise.all(Array.from({ length: conc }, worker));
await browser.close();
const file = path.join(OUT, `interact-${persona}-${device}-${theme}${only ? "-" + slug(only) : ""}.json`);
fs.writeFileSync(file, JSON.stringify(findings, null, 1));
console.log("wrote", file);
