import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { tokenize } from "./highlight";
import { ENTRIES, GROUPS } from "./registry";
import { DEMOS, DEMO_SOURCE } from "./sources";

/**
 * The documentation, checked against what it documents (§60).
 *
 * A docs page drifts in three ways: a demo it names stops existing, a demo
 * file is written and never shown, and a props table keeps a prop the
 * component renamed. Each of those fails here.
 */
describe("the component documentation", () => {
  it("names only demos that exist, each a module with a component and its source", () => {
    for (const entry of ENTRIES) {
      for (const demo of entry.demos) {
        expect(DEMOS[demo.id]?.default, `${entry.id} → ${demo.id}`).toBeTypeOf("function");
        expect(DEMO_SOURCE[demo.id], demo.id).toContain("export default function");
      }
    }
  });

  it("shows every demo file somewhere", () => {
    const used = new Set(ENTRIES.flatMap((entry) => entry.demos.map((demo) => demo.id)));
    expect(Object.keys(DEMOS).filter((id) => !used.has(id))).toEqual([]);
  });

  it("has at least sixty demos across every group", () => {
    expect(Object.keys(DEMOS).length).toBeGreaterThanOrEqual(60);
    for (const group of GROUPS) {
      expect(ENTRIES.some((entry) => entry.group === group), group).toBe(true);
    }
  });

  it("keeps entry ids unique, so every anchor lands once", () => {
    const ids = ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("documents only props the component's source actually has", () => {
    for (const entry of ENTRIES) {
      if (!entry.component || !entry.api) continue;
      const source = readFileSync(join(process.cwd(), "src/components", `${entry.component}.tsx`), "utf8");
      for (const prop of entry.api) {
        // `size` on PersonAvatar comes from AntD's Avatar, which it spreads.
        if (entry.component === "PersonAvatar" && prop.name === "size") continue;
        expect(new RegExp(`\\b${prop.name}\\??:`).test(source), `${entry.component}.${prop.name}`).toBe(true);
      }
    }
  });
});

describe("the highlighter", () => {
  it("tells comments, strings, keywords, components and attributes apart", () => {
    const kinds = Object.fromEntries(
      tokenize('// note\nimport { A } from "x";\n<Button type="primary" size={2}>').filter(([kind]) => kind !== "plain").map(([kind, text]) => [text, kind]),
    );
    expect(kinds["// note"]).toBe("comment");
    expect(kinds["import"]).toBe("keyword");
    expect(kinds['"x"']).toBe("string");
    expect(kinds["Button"]).toBe("component");
    expect(kinds["type"]).toBe("attr");
    expect(kinds["2"]).toBe("number");
  });

  it("loses nothing: the tokens join back into the source", () => {
    const source = DEMO_SOURCE["table.states"]!;
    expect(tokenize(source).map(([, text]) => text).join("")).toBe(source);
  });
});
