// Fold scan/interact JSON into a readable digest grouped by route.
//   node e2e/audit-b/summarize.mjs e2e/audit-b/.out/scan-admin.json [--kind axe|geo|log]
import fs from "node:fs";

const [file, , kind = "all"] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const data = Array.isArray(raw) ? raw : raw.findings;
const by = {};
const add = (route, key, msg) => {
  by[route] ??= {};
  by[route][msg] ??= new Set();
  by[route][msg].add(key);
};
for (const r of data) {
  const key = `${r.device}/${r.theme}`;
  if (r.items) {
    for (const it of r.items) for (const i of it.issues) add(r.route, key, `[${it.label}] ${i}`);
    for (const it of r.items) for (const v of it.axe ?? []) add(r.route, key, `[${it.label}] axe ${v.id} (${v.n}) ${v.targets[0] ?? ""}`);
    for (const h of r.http ?? []) add(r.route, key, `http ${h}`);
    if (r.error) add(r.route, key, `ERROR ${r.error}`);
    continue;
  }
  if (r.status !== "ok") add(r.route, key, r.status);
  if (kind === "all" || kind === "log") {
    for (const c of r.console) add(r.route, key, `console ${c.replace(/\d{2}:\d{2}:\d{2}/g, "")}`);
    for (const c of r.pageErrors) add(r.route, key, `pageerror ${c}`);
    for (const c of r.failed) add(r.route, key, `reqfail ${c}`);
    for (const c of r.http) add(r.route, key, `http ${c.replace(/[0-9a-f-]{36}/g, "<id>")}`);
  }
  if ((kind === "all" || kind === "geo") && r.geo) {
    const g = r.geo;
    if (g.overflowX) add(r.route, key, `overflowX ${g.overflowX}px`);
    for (const x of g.offscreen ?? []) add(r.route, key, `offscreen ${x}`);
    for (const x of g.clipped ?? []) add(r.route, key, `clipped ${x}`);
    for (const x of g.overlaps ?? []) add(r.route, key, `overlap ${x}`);
    for (const x of g.small ?? []) add(r.route, key, `small ${x}`);
    for (const x of g.squareCorners ?? []) add(r.route, key, `square ${x}`);
    if (g.cls > 0.1) add(r.route, key, `CLS ${g.cls.toFixed(3)}`);
  }
  if (kind === "all" || kind === "axe") for (const v of r.axe ?? []) add(r.route, key, `axe ${v.id}/${v.impact} ×${v.n}: ${v.targets.join(" || ")}`);
}
for (const [route, msgs] of Object.entries(by)) {
  console.log(`\n## ${route}`);
  for (const [m, keys] of Object.entries(msgs)) console.log(`  - ${m}  {${[...keys].join(" ")}}`);
}
