import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { API_PREFIX } from "@/config";

/**
 * Every address the client calls is one the API mounts (§71, §76).
 *
 * The two halves of this repository agree about the API surface by *hand*: the
 * backend mounts what `maps/endpoint.json` declares, and `src/api/*.ts` names
 * the same paths in string literals. Nothing checked that they matched, so a
 * renamed endpoint or a typed path was a 404 in a browser — found by whoever
 * opened the page next, and only if they opened it.
 *
 * This is the drift check the tracker asked for. It reads the *map*, not a
 * running server: a test that needs the stack up is a test that gets skipped,
 * and the map is the same declaration the stack mounts from.
 *
 * What it deliberately does not assert is the reverse — an endpoint with no
 * caller. The health probes have none by design, `/meta/routes` is for a
 * developer with curl, and a template ships more API than any one page uses.
 */

const API_DIR = join(process.cwd(), "src", "api");
const MAP = join(process.cwd(), "..", "backend", "maps", "endpoint.json");

interface MapDocument {
  endpoints: Array<{ namespace: string; api_url: string; request_method: string[] }>;
}

/** Every mounted path, with its parameters reduced to `*`. */
function mountedPaths(): Set<string> {
  const document = JSON.parse(readFileSync(MAP, "utf8")) as MapDocument;
  return new Set(
    document.endpoints.map(
      (endpoint) => `/${endpoint.namespace}${endpoint.api_url}`.replace(/<[^>]+>/g, "*"),
    ),
  );
}

/**
 * The first string argument of every `api.*` / `download` call in the client,
 * with its interpolations resolved to what they are.
 *
 * Hand-rolled rather than parsed with an AST, for the reason the other source
 * rules give: one dependency less, and the failure names the file and the
 * literal. The one subtlety is that an interpolation is either a **path
 * segment** (`${id}`) or a **query string** (`${query(params)}`, a ternary
 * that returns `?x=y`) — the first is part of the address and the second is
 * not, and treating them alike matches nothing.
 */
function clientCalls(): Array<{ file: string; raw: string; path: string }> {
  const out: Array<{ file: string; raw: string; path: string }> = [];
  for (const name of readdirSync(API_DIR)) {
    if (!name.endsWith(".ts") || name.includes(".test.")) continue;
    const source = readFileSync(join(API_DIR, name), "utf8");
    // `api.get<Thing>("…"`, `api.delete("…"`, `download("…"`, `stream(`…`)`.
    const calls = /(?:api\.(?:get|post|put|patch|delete)(?:<[^(]*?>)?|download|upload)\(\s*([`"])/g;
    for (const match of source.matchAll(calls)) {
      const quote = match[1]!;
      const start = match.index + match[0].length;
      const literal = readLiteral(source, start, quote);
      if (literal === null || !literal.startsWith("/")) continue;
      out.push({ file: name, raw: literal, path: normalise(literal) });
    }
  }
  return out;
}

/** The literal starting at `start`, brace-aware so `${a ? "?x" : ""}` survives. */
function readLiteral(source: string, start: number, quote: string): string | null {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "{" && source[index - 1] === "$") depth += 1;
    else if (character === "}" && depth > 0) depth -= 1;
    else if (character === quote && depth === 0) return source.slice(start, index);
  }
  return null;
}

export function normalise(literal: string): string {
  let out = "";
  for (let index = 0; index < literal.length; index += 1) {
    if (literal[index] === "$" && literal[index + 1] === "{") {
      let depth = 1;
      let end = index + 2;
      for (; end < literal.length && depth > 0; end += 1) {
        if (literal[end] === "{") depth += 1;
        else if (literal[end] === "}") depth -= 1;
      }
      const expression = literal.slice(index + 2, end - 1);
      // A query string is not part of the address; a path segment is.
      const isQuery = /\bquery\(|["'`]\?/.test(expression);
      out += isQuery ? "" : "*";
      index = end - 1;
      continue;
    }
    out += literal[index];
  }
  // A literal query string, and a trailing slash, are not the address either.
  return out.replace(/\?.*$/, "").replace(/\/$/, "");
}

describe("the client and the API map describe one surface", () => {
  it("finds the calls and the map at all", () => {
    // Without this the assertion below could pass by reading nothing, which
    // is the failure mode of every source-level rule.
    expect(mountedPaths().size).toBeGreaterThan(100);
    const calls = clientCalls();
    expect(calls.length).toBeGreaterThan(100);
    expect(calls.some((call) => call.raw.includes("${"))).toBe(true);
  });

  it("uses the prefix the API mounts its namespace at", () => {
    const document = JSON.parse(readFileSync(MAP, "utf8")) as MapDocument;
    const namespaces = new Set(document.endpoints.map((endpoint) => endpoint.namespace));
    expect([...namespaces]).toEqual([API_PREFIX.replace(/^\//, "")]);
  });

  it("calls no address the API does not mount", () => {
    const mounted = mountedPaths();
    const unmatched = clientCalls()
      .filter((call) => !mounted.has(`${API_PREFIX}${call.path}`))
      .map((call) => `${call.file}: ${call.raw}`);
    expect(unmatched).toEqual([]);
  });

  it("resolves an interpolation to a segment or to nothing, by what it is", () => {
    // The rule the whole check rests on, asserted directly so a failure above
    // is about the client rather than about this parser.
    expect(normalise("/api/records/${type}/${id}")).toBe("/api/records/*/*");
    expect(normalise("/api/announcements${query(params)}")).toBe("/api/announcements");
    expect(normalise("/api/activity${suffix ? `?after=${suffix}` : ''}")).toBe("/api/activity");
    expect(normalise("/admin/logs?tail=1")).toBe("/admin/logs");
  });
});
