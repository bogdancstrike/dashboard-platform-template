// Remove every throwaway row the audit flows created ("zzauditB …"), through
// the API with the admin's own token.   node e2e/audit-b/cleanup.mjs
import { BASE, context, launch } from "./lib.mjs";

const browser = await launch();
const ctx = await context(browser, {});
const page = await ctx.newPage();
let token = "";
page.on("request", (r) => {
  const h = r.headers()["authorization"];
  if (h?.startsWith("Bearer ")) token = h.slice(7);
});
await page.goto(BASE + "/home");
await page.waitForSelector("#nu-main", { timeout: 60_000 });
for (let i = 0; i < 40 && !token; i++) await page.waitForTimeout(250);
const H = { Authorization: `Bearer ${token}` };
const api = (p) => BASE + "/platform" + p;
const isMine = (s) => /zzaudit/i.test(String(s ?? ""));
let removed = 0;

for (const type of ["customer", "ticket", "project", "order", "device"]) {
  const r = await page.request.post(api("/api/explorer/query"), { headers: H, data: { resource_type: type, query_text: "zzauditB", page_size: 100 } });
  if (!r.ok()) continue;
  for (const row of (await r.json()).items ?? []) {
    if (!Object.values(row).some(isMine)) continue;
    const d = await page.request.delete(api(`/api/records/${type}/${row.id}`), { headers: H });
    console.log(type, row.id, d.status());
    removed++;
  }
}
const lists = [
  ["/admin/groups?page_size=200", (x) => x.name, (x) => `/admin/groups/${x.id}`],
  ["/tags", (x) => x.name, (x) => `/tags/${x.id}`],
  ["/admin/flags", (x) => x.key ?? x.name, (x) => `/admin/flags/${x.key}`],
  ["/api/saved-searches?page_size=200", (x) => x.name, (x) => `/api/saved-searches/${x.id}`],
  ["/admin/api-clients?page_size=200", (x) => x.name, (x) => `/admin/api-clients/${x.id}`],
];
for (const [list, nameOf, del] of lists) {
  const r = await page.request.get(api(list), { headers: H });
  if (!r.ok()) {
    console.log("list", list, r.status());
    continue;
  }
  const body = await r.json();
  for (const x of body.items ?? body ?? []) {
    if (!isMine(nameOf(x)) && !isMine(x.name)) continue;
    const d = await page.request.delete(api(del(x)), { headers: H });
    console.log(list, nameOf(x), d.status());
    removed++;
  }
}
console.log("removed", removed);
await browser.close();
