// The import wizard up to (never through) the import: upload a small CSV with
// one bad row, map, check, look at the problems, discard the draft.
//   node e2e/audit-b/importwiz.mjs [--device pc|phone]
import fs from "node:fs";
import path from "node:path";
import { BASE, OUT, SHOTS, axe, context, launch, settle, watch } from "./lib.mjs";

const device = process.argv.includes("--device") ? process.argv[process.argv.indexOf("--device") + 1] : "pc";
const csv = path.join(OUT, "zzauditB.csv");
fs.writeFileSync(csv, "Name,Email,Lifetime value\nzzauditB One,one@example.com,100\nzzauditB Two,not-an-email,abc\n,missing@example.com,5\n");
const browser = await launch();
const ctx = await context(browser, { device });
const page = await ctx.newPage();
const log = watch(page);
const shot = (n) => page.screenshot({ path: path.join(SHOTS, `auditB_import_${n}_${device}_light.png`), fullPage: false });
await page.goto(BASE + "/import");
await page.waitForSelector("#nu-main");
await settle(page, 800);
await shot("1-start");
await page.locator('input[type="file"]').first().setInputFiles(csv);
await page.getByTestId("import-mapping").waitFor({ timeout: 30_000 }).catch(() => console.log("no mapping step"));
await settle(page, 500);
await shot("2-mapping");
console.log("dialect:", await page.getByTestId("dialect").innerText().catch(() => "-"));
console.log("unmapped:", await page.getByTestId("unmapped").innerText().catch(() => "-"));
await page.getByTestId("check-mapping").click().catch((e) => console.log("check failed", e.message.split("\n")[0]));
await page.getByTestId("import-preview").waitFor({ timeout: 30_000 }).catch(() => console.log("no preview"));
await settle(page, 500);
await shot("3-check");
console.log("counts:", (await page.getByTestId("import-counts").innerText().catch(() => "-")).replace(/\n/g, " | "));
const ax = await axe(page);
console.log("axe:", ax.map((v) => `${v.id}(${v.n}) ${v.targets[0]}`).join(" || ") || "clean");
const discard = page.getByTestId("discard-run");
if (await discard.count()) {
  await discard.click();
  await page.waitForTimeout(500);
  const ok = page.locator(".ant-popconfirm .ant-btn-primary, .ant-modal-confirm .ant-btn-primary, .ant-modal .ant-btn-dangerous").filter({ visible: true }).last();
  if (await ok.count()) await ok.click();
  await settle(page, 600);
  console.log("discarded; history:", (await page.getByTestId("import-history").first().innerText().catch(() => "-")).slice(0, 160).replace(/\n/g, " | "));
}
await shot("4-discarded");
console.log("console:", log.console, log.pageErrors, log.http.filter((h) => !h.includes("/realms/")));
await browser.close();
