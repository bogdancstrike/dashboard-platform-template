#!/usr/bin/env node
// Frontend bundle-size budget (docs/testing/performance.md).
//
//   node loadtest/frontend/bundle-budget.mjs [dist-dir]     # default frontend/dist
//
// Reads the production build and checks, gzipped:
//   * the INITIAL load — the entry script, every <link rel=modulepreload> and
//     the stylesheets index.html pulls in: what a first visit downloads before
//     anything renders;
//   * the largest lazily loaded chunk — the worst single page open;
//   * the total JavaScript.
// Budgets are today's sizes plus ~10 % headroom: they exist to catch a
// regression (a heavy import pulled into the entry), not to freeze the build.
// Override with BUDGET_INITIAL_KB / BUDGET_CHUNK_KB / BUDGET_TOTAL_KB.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const dist = resolve(process.argv[2] ?? "frontend/dist");
const kb = (bytes) => Math.round(bytes / 102.4) / 10;
const gz = (file) => gzipSync(readFileSync(file), { level: 9 }).length;

const budgets = {
  initial: Number(process.env.BUDGET_INITIAL_KB ?? 465),
  chunk: Number(process.env.BUDGET_CHUNK_KB ?? 375),
  total: Number(process.env.BUDGET_TOTAL_KB ?? 1950),
};

const html = readFileSync(join(dist, "index.html"), "utf8");
const initialRefs = new Set(
  [...html.matchAll(/(?:src|href)="\/?([^"]+\.(?:js|css))"/g)].map((m) => m[1]),
);
const assets = readdirSync(join(dist, "assets"))
  .filter((name) => /\.(js|css)$/.test(name))
  .map((name) => {
    const file = join(dist, "assets", name);
    return { name, raw: statSync(file).size, gzip: gz(file), initial: initialRefs.has(`assets/${name}`) };
  });

const initial = assets.filter((a) => a.initial);
const initialGzip = initial.reduce((sum, a) => sum + a.gzip, 0);
const lazy = assets.filter((a) => !a.initial && a.name.endsWith(".js")).sort((a, b) => b.gzip - a.gzip);
const totalJs = assets.filter((a) => a.name.endsWith(".js")).reduce((sum, a) => sum + a.gzip, 0);

console.log(`initial load (${initial.length} files):`);
for (const a of initial.sort((a, b) => b.gzip - a.gzip)) console.log(`  ${kb(a.gzip).toString().padStart(7)} kB gz  ${a.name}`);
console.log(`largest lazy chunks:`);
for (const a of lazy.slice(0, 5)) console.log(`  ${kb(a.gzip).toString().padStart(7)} kB gz  ${a.name}`);

const results = [
  ["initial load", kb(initialGzip), budgets.initial],
  ["largest lazy chunk", kb(lazy[0]?.gzip ?? 0), budgets.chunk],
  ["total JavaScript", kb(totalJs), budgets.total],
];
let failed = false;
console.log("\nbudget (gzip):");
for (const [label, size, budget] of results) {
  const ok = size <= budget;
  failed ||= !ok;
  console.log(`  ${ok ? "ok  " : "OVER"} ${label.padEnd(20)} ${String(size).padStart(7)} kB  / ${budget} kB`);
}
process.exit(failed ? 1 : 0);
