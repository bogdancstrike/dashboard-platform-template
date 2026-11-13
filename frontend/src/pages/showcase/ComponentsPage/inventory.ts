

import { DOCUMENTED_COMPONENTS } from "../docs/registry";

/**
 * Every shared component file, from the directory itself.
 *
 * Only the *names* are wanted, never the modules — the page imports what it
 * demonstrates by hand — so nothing here is eager and the glob costs no
 * behaviour.
 *
 * **The test files are excluded in the pattern, and that is not a style
 * choice.** The first version globbed `*.tsx` and filtered the names
 * afterwards, which is too late: Vite builds a dynamic import for every match
 * *before* any filter runs, so `ExportButton.test.tsx` entered the production
 * module graph and dragged MSW in with it. The build then failed outright —
 * which was lucky, because the quiet version of that mistake is a bundle that
 * builds and ships the mock server. `docs/RBAC.md` promises test fixtures are
 * excluded from the runtime graph; a glob is exactly how that promise gets
 * broken, so the exclusion belongs where Vite reads it.
 */
const FILES = import.meta.glob(["../../../components/*.tsx", "!../../../components/*.test.tsx"]);

/** The component names the directory contains, derived and sorted. */
export function inventory(paths: string[] = Object.keys(FILES)): string[] {
  return paths
    .map((path) => path.split("/").pop() ?? "")
    // Belt and braces: the glob already excludes these, and this keeps
    // `inventory` honest when it is called with paths in a test.
    .filter((name) => name.endsWith(".tsx") && !name.includes(".test."))
    .map((name) => name.replace(/\.tsx$/, ""))
    .sort();
}

/**
 * Which shared components this page documents — derived from the registry,
 * and compared against the inventory so the gap is published, not hidden.
 */
const DEMONSTRATED: readonly string[] = DOCUMENTED_COMPONENTS;

/**
 * What the page can and cannot show, as one fact.
 *
 * Returned as a value so it can be asserted directly: the test that matters is
 * the one saying every component in the directory is either demonstrated or
 * *listed as not*, because that is the property a drifting gallery loses.
 */
export function coverage(
  names: string[] = inventory(),
  shown: readonly string[] = DEMONSTRATED,
): { shown: string[]; missing: string[]; total: number } {
  const set = new Set(shown);
  return {
    shown: names.filter((name) => set.has(name)),
    missing: names.filter((name) => !set.has(name)),
    total: names.length,
  };
}
