import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/**
 * The shipped source files, for the tests that assert a rule about *all* of
 * them.
 *
 * Three such tests exist — no shipped module may reach the fixtures
 * (`isolation.test.ts`), no page may hand a computed colour to a `Tag`
 * (`StatusTag.test.tsx`), and every progress bar must be named or hidden
 * (`a11y.test.ts`) — and the first two had grown their own copy of this walk.
 * The second copy is where a rule quietly stops covering a directory the first
 * one learnt about.
 *
 * Not shipped itself: it lives under `src/test/`, which the isolation test
 * keeps out of the production module graph.
 */

export const SRC = join(process.cwd(), "src");

export interface ShippedSource {
  /** Absolute path, for reading. */
  path: string;
  /** Path relative to `src`, which is what a failure message should name. */
  name: string;
  source: string;
}

/**
 * Every source file that is part of the shipped application.
 *
 * `.tsx` only by default, because the rules above are about JSX; pass
 * `extension` for a rule about modules in general.
 */
export function shippedFiles(
  extension: RegExp = /\.tsx$/,
  directory: string = SRC,
): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      // `src/test` is the fixtures themselves.
      if (entry === "test") continue;
      out.push(...shippedFiles(extension, path));
      continue;
    }
    if (!extension.test(entry) || entry.includes(".test.")) continue;
    out.push(path);
  }
  return out;
}

/** The same files, read. */
export function shippedSources(extension?: RegExp): ShippedSource[] {
  return shippedFiles(extension).map((path) => ({
    path,
    name: relative(SRC, path),
    source: readFileSync(path, "utf8"),
  }));
}

/**
 * Every routed page under `src/pages/`, with the modules it is built from.
 *
 * A page is either `XPage.tsx` or, once split, the folder `XPage/` whose
 * `index.tsx` is what the router loads. Either way the page's `source` is its
 * own text followed by the text of every module it reaches through relative
 * imports (`./parts`, `./xPage/useXPage`), so a rule like "every page fills
 * the palette" still holds when the call moved into the page's own hook.
 */
export function pageSources(): ShippedSource[] {
  return shippedFiles(/\.tsx$/, join(SRC, "pages"))
    .filter((path) => /Page\.tsx$/.test(path) || /Page[\\/]index\.tsx$/.test(path))
    .map((path) => ({ path, name: relative(SRC, path), source: withOwnModules(path) }));
}

/**
 * A page's text and that of the modules it owns: for `XPage/index.tsx`, what
 * it imports from inside `XPage/`; for `XPage.tsx`, what it imports from a
 * folder beside it (`./xPage/...`). A sibling page it borrows a constant from
 * is somebody else's page and is not read as this one.
 */
function withOwnModules(entry: string): string {
  const root = dirname(entry);
  const folderPage = /index\.tsx$/.test(entry);
  const owned = (path: string) => path.startsWith(`${root}/`) && (folderPage || dirname(path) !== root);
  const seen = new Set<string>();
  const read = (path: string): string => {
    if (seen.has(path)) return "";
    seen.add(path);
    const text = readFileSync(path, "utf8");
    const parts = [text];
    for (const match of text.matchAll(/from "(\.{1,2}\/[^"]+)"/g)) {
      const found = resolveModule(join(dirname(path), match[1]!));
      if (found && owned(found)) parts.push(read(found));
    }
    return parts.join("\n");
  };
  return read(entry);
}

function resolveModule(base: string): string | undefined {
  return [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")].find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * Every `<Tag …>` element in a source file, as text.
 *
 * A real parser would be better and is not worth an AST dependency for three
 * rules. The one subtlety is that a `>` inside a prop expression — an arrow
 * function, a comparison — must not end the element, so this tracks brace
 * depth and only accepts a `>` outside braces.
 */
export function jsxElements(source: string, tag: string): string[] {
  const out: string[] = [];
  const opening = new RegExp(`<${tag}[\\s/>]`, "g");
  for (const match of source.matchAll(opening)) {
    const start = match.index;
    let depth = 0;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth === 0) {
        out.push(source.slice(start, index + 1));
        break;
      }
    }
  }
  return out;
}

/**
 * The router's source, for the tests that enumerate routes by reading it.
 *
 * `App.tsx` mounts the table and `app/routes/*.tsx` declares it, one module
 * per navigation area; reading them together keeps those tests independent of
 * how the table is split.
 */
export function routerSource(): string {
  const routes = join(SRC, "app", "routes");
  const modules = readdirSync(routes)
    .filter((entry) => /\.tsx?$/.test(entry) && !entry.includes(".test."))
    .sort()
    .map((entry) => readFileSync(join(routes, entry), "utf8"));
  return [readFileSync(join(SRC, "App.tsx"), "utf8"), ...modules].join("\n");
}

/**
 * A stylesheet entry under `src/styles/`, with its `@import`s inlined in
 * cascade order — `stylesheetSource("global")` is what used to be
 * `src/index.css`, now split by concern into `styles/global/*.css`.
 */
export function stylesheetSource(entry: string): string {
  const path = join(SRC, "styles", `${entry}.css`);
  const text = readFileSync(path, "utf8");
  return text.replace(/@import\s+"\.\/([^"]+)";/g, (_, file: string) =>
    readFileSync(join(SRC, "styles", file), "utf8"),
  );
}
