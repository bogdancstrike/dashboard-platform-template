import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

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
