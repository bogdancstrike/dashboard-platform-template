import { readFileSync } from "node:fs";
import { relative } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC, shippedFiles } from "@/test/sources";

/**
 * The test fixtures must not reach the shipped bundle.
 *
 * `docs/RBAC.md` has promised since it was written that "test fixtures under
 * `frontend/src/test/` simulate HTTP responses for isolated component tests
 * only and are excluded from the runtime module graph" — and nothing enforced
 * it. Then `/showcase/components` (§60) globbed `src/components/*.tsx` to
 * derive its inventory, which made Vite build a dynamic import for
 * `ExportButton.test.tsx`, which imports the mock server, which imports MSW.
 *
 * The production build failed outright, which was luck: the quiet version of
 * that mistake is a bundle that builds and ships a mock HTTP layer capable of
 * answering `/api/me` with whatever permissions it likes. So the promise is a
 * test now.
 *
 * Two rules, and the second is the one the glob broke:
 *
 * **No shipped module imports from `@/test/`.** Direct, and easy to see.
 *
 * **No `import.meta.glob` matches a test file.** Indirect, invisible in
 * review, and the way it actually happened — a filter applied to the *names*
 * after globbing is too late, because the module graph is built from the
 * pattern.
 */

describe("the shipped bundle cannot reach the test fixtures", () => {
  it("finds the application's own files at all", () => {
    // Without this the two assertions below could pass by looking at nothing.
    const files = shippedFiles();
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((path) => path.endsWith("App.tsx"))).toBe(true);
  });

  it("has no shipped module importing from src/test", () => {
    const offenders: string[] = [];
    for (const path of shippedFiles()) {
      const source = readFileSync(path, "utf8");
      if (/from\s+["'](@\/test\/|\.{1,2}\/(\.\.\/)*test\/)/.test(source)) {
        offenders.push(relative(SRC, path));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("has no glob that would pull a test file into the module graph", () => {
    // The way it happened. Vite creates a dynamic import per match *before*
    // any filter over the names runs, so the exclusion has to be in the
    // pattern — `["…/*.tsx", "!…/*.test.tsx"]`.
    const offenders: string[] = [];
    for (const path of shippedFiles()) {
      const source = readFileSync(path, "utf8");
      for (const match of source.matchAll(/import\.meta\.glob\(([^)]*)\)/gs)) {
        const call = match[1] ?? "";
        const globsTsx = /\*\.tsx?["']/.test(call);
        const excludesTests = /!.*\.test\./.test(call);
        if (globsTsx && !excludesTests) {
          offenders.push(`${relative(SRC, path)}: ${call.replace(/\s+/g, " ").trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
