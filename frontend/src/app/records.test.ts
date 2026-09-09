import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { RECORD_PAGES } from "@/app/records";

/**
 * `RECORD_PAGES` says which datasets have a record page; the router decides.
 *
 * The set exists because enumerating React Router's table means rendering
 * every lazy page, and the palette needs the answer synchronously to choose
 * between a record's own address and the explorer narrowed to it. A hand-kept
 * copy of a routing decision is wrong by the third new page — unless something
 * reads the router and says so, which is what this does (§8, §61).
 */

const APP = join(process.cwd(), "src", "App.tsx");

/** The entity table in `App.tsx`: `{ path: "tickets", key: "ticket", … }`. */
function routedEntities(): Set<string> {
  const source = readFileSync(APP, "utf8");
  return new Set(
    [...source.matchAll(/\{\s*path:\s*"[^"]+",\s*key:\s*"([^"]+)"/g)].map((match) => match[1]!),
  );
}

/** The keys served under a bespoke route rather than through that table. */
function bespoke(): Set<string> {
  const source = readFileSync(APP, "utf8");
  const out = new Set<string>();
  // `/tasks/:id` is declared on its own, because the list is a board.
  if (/path="tasks"/.test(source) && /TaskDetailPage/.test(source)) out.add("task");
  return out;
}

describe("the record-page set", () => {
  it("reads the router at all", () => {
    // Without this the comparison below could pass by parsing nothing, which
    // is how a completeness test certifies a hole.
    expect(routedEntities().size).toBeGreaterThanOrEqual(5);
    expect(routedEntities()).toContain("ticket");
  });

  it("is exactly the set of datasets the router serves a record page for", () => {
    const served = new Set([...routedEntities(), ...bespoke()]);
    expect([...RECORD_PAGES].sort()).toEqual([...served].sort());
  });
});
