// Static crawl: every audit-B route x device x theme (x persona), probes + axe
// + screenshot. Usage (from frontend/):
//   node e2e/audit-b/scan.mjs [--devices pc,tablet,phone] [--themes light,dark]
//        [--persona admin] [--only /admin] [--no-axe] [--conc 3]
// Writes e2e/audit-b/.out/scan-<persona>.json and screenshots auditB_<...>.png.
import fs from "node:fs";
import path from "node:path";
import { BASE, OUT, SHOTS, axe, context, launch, probe, settle, slug, watch, ensureLogin } from "./lib.mjs";
import { ROUTES, resolveIds } from "./routes.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const devices = opt("devices", "pc,tablet,phone").split(",");
const themes = opt("themes", "light,dark").split(",");
const persona = opt("persona", "admin");
const only = opt("only", "");
const conc = Number(opt("conc", "3"));
const runAxe = !args.includes("--no-axe");

const browser = await launch();
await ensureLogin(browser, persona);
const ids = await resolveIds(browser, persona);
const routes = ROUTES(ids).filter((r) => !only || only.split(",").some((o) => r.startsWith(o)));
console.log(`${routes.length} routes x ${devices.length} devices x ${themes.length} themes as ${persona} on ${BASE}`);

const jobs = [];
for (const route of routes) for (const device of devices) for (const theme of themes) jobs.push({ route, device, theme });
const results = [];
let done = 0;

async function worker() {
  const ctxs = {};
  while (jobs.length) {
    const job = jobs.shift();
    const key = `${job.device}-${job.theme}`;
    ctxs[key] ??= await context(browser, { persona, device: job.device, theme: job.theme });
    const page = await ctxs[key].newPage();
    const log = watch(page);
    const t0 = Date.now();
    let status = "ok";
    try {
      await page.goto(BASE + job.route, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForSelector(".nx-app, form, main, #kc-form-login", { timeout: 45_000 }).catch(() => undefined);
      await settle(page, 900);
    } catch (e) {
      status = `load-failed: ${String(e).slice(0, 120)}`;
    }
    const geo = await probe(page).catch((e) => ({ error: String(e) }));
    // Axe once per route per theme (layout-only differences across devices are
    // what the probes cover) — but on phone too, where nav is different.
    const ax = runAxe && job.device !== "tablet" ? await axe(page) : [];
    const shot = `auditB_${persona === "admin" ? "" : persona + "_"}${slug(job.route)}_${job.device}_${job.theme}.png`;
    await page.screenshot({ path: path.join(SHOTS, shot) }).catch(() => undefined);
    const title = await page.locator("h1").first().innerText({ timeout: 500 }).catch(() => "");
    results.push({ ...job, persona, status, title, ms: Date.now() - t0, url: page.url(), ...log, geo, axe: ax, shot });
    await page.close();
    done++;
    if (done % 10 === 0) console.log(`${done} done`);
  }
  for (const c of Object.values(ctxs)) await c.close();
}
await Promise.all(Array.from({ length: conc }, worker));
await browser.close();

const file = path.join(OUT, `scan-${persona}${only ? "-" + slug(only) : ""}.json`);
fs.writeFileSync(file, JSON.stringify(results, null, 1));
console.log("wrote", file);
