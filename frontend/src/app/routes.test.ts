import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SRC, shippedSources } from "@/test/sources";

/**
 * Every address the product sends somebody to is one the router serves.
 *
 * `/home`'s "How you like things" button and its palette command both pointed
 * at `/preferences`, and the route is `/settings/preferences` — so the friendly
 * button on the landing page of the application was a 404. Nothing caught it,
 * because a `navigate()` with a wrong string is valid TypeScript and a
 * `<Link>` to nowhere renders perfectly.
 *
 * The claim here is narrow on purpose: **a literal, static path must match a
 * declared route.** Anything computed — a template literal, a variable, a
 * parameter — is out of scope, because the router's `:id` segments make those
 * unverifiable from the source. The static ones are where this class of typo
 * lives anyway: a computed path is built from a route somebody had to look up.
 */

const ROUTER = readFileSync(join(SRC, "App.tsx"), "utf8");

/** Every path the router serves, as literal segments with `:params` kept. */
const DECLARED: string[] = [
  ...[...ROUTER.matchAll(/path=(?:"|\{")([^"]+)"/g)].map((match) => match[1]!),
  // The five entity routes are generated from an array rather than written
  // out, so they are declared as object properties instead of JSX props.
  ...[...ROUTER.matchAll(/path: "([^"]+)"/g)].map((match) => match[1]!),
];

/**
 * Whether the router serves this path.
 *
 * Compared segment by segment so a declared `:id` matches anything in that
 * position — `/tasks/abc-123` is served by `tasks/:id`. Nested routes are
 * declared as relative segments, so a path matches when its segments can be
 * covered by *some* declared route's segments, which is what the walk below
 * approximates by checking each declared path as a suffix or a whole.
 */
function served(path: string): boolean {
  const wanted = path.replace(/^\//, "").split("/").filter(Boolean);
  if (wanted.length === 0) return true; // `/` is the shell itself

  // A route declared whole. A bare `:param` is skipped here: those are always
  // *child* routes in this router — `:id` under `tasks`, `:userId` under
  // `admin/users` — and treating one as a whole path would make every
  // single-segment address match, which is precisely the hole that let
  // `/preferences` pass while the route was `/settings/preferences`.
  for (const route of DECLARED) {
    const parts = route.replace(/^\//, "").split("/").filter(Boolean);
    if (parts.length === 1 && parts[0]!.startsWith(":")) continue;
    if (parts.length === wanted.length && parts.every((part, index) =>
      part.startsWith(":") || part === wanted[index]
    )) {
      return true;
    }
  }

  // Nested: a parent route plus a child route, both declared. `admin/users`
  // is a parent and `:userId` its child, so `/admin/users/u-1` is served.
  for (let cut = 1; cut < wanted.length; cut += 1) {
    const head = wanted.slice(0, cut).join("/");
    const tail = wanted.slice(cut);
    if (!DECLARED.includes(head)) continue;
    if (
      DECLARED.some((route) => {
        const parts = route.replace(/^\//, "").split("/").filter(Boolean);
        return (
          parts.length === tail.length &&
          parts.every((part, index) => part.startsWith(":") || part === tail[index])
        );
      })
    ) {
      return true;
    }
  }
  return false;
}

/** Static destinations in the shipped source: `navigate("/x")`, `to="/x"`. */
function destinations(): { file: string; path: string }[] {
  const found: { file: string; path: string }[] = [];
  for (const file of shippedSources(/\.tsx$/)) {
    const patterns = [
      /\bnavigate\(\s*"(\/[^"?#]*)[^"]*"/g,
      /\bto="(\/[^"?#]*)[^"]*"/g,
      /\bto=\{\s*"(\/[^"?#]*)[^"]*"\s*\}/g,
    ];
    for (const pattern of patterns) {
      for (const match of file.source.matchAll(pattern)) {
        found.push({ file: file.name, path: match[1]! });
      }
    }
  }
  return found;
}

describe("every static destination is a route", () => {
  it("finds destinations to check at all", () => {
    // A guard on the guard: a regex that stopped matching would otherwise turn
    // the assertion below into a test that passes by checking nothing.
    expect(destinations().length).toBeGreaterThan(50);
  });

  it("sends nobody to a page the router does not serve", () => {
    const broken = destinations()
      .filter(({ path }) => !served(path))
      .map(({ file, path }) => `${file} → ${path}`)
      .sort();

    expect([...new Set(broken)], "these go nowhere").toEqual([]);
  });
});
