import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "./client";

/**
 * Every API client function, called, and the request it actually sends
 * checked against the backend's endpoint map.
 *
 * `contract.test.ts` reads the *source* for path literals. This is its runtime
 * half: template strings are interpolated, query strings built and methods
 * chosen by the code that will run in the browser, so a wrapper that
 * concatenates a path wrongly — `/api/x` + `id` without the slash — or sends a
 * POST where the server mounts a PUT is caught here, where the source scan
 * sees only a plausible-looking literal.
 */

interface MapDocument {
  endpoints: Array<{ namespace: string; api_url: string; request_method: string[] }>;
}

const MAP = join(process.cwd(), "..", "backend", "maps", "endpoint.json");

const routes = (JSON.parse(readFileSync(MAP, "utf8")) as MapDocument).endpoints.map((endpoint) => ({
  pattern: new RegExp(
    `^/${endpoint.namespace}${endpoint.api_url.replace(/<[^>]+>/g, "[^/]+")}$`,
  ),
  methods: new Set(endpoint.request_method),
  url: `/${endpoint.namespace}${endpoint.api_url}`,
}));

const modules = import.meta.glob<Record<string, unknown>>(["./*.ts", "!./*.test.ts", "!./client.ts"], {
  eager: true,
});

interface Sent {
  module: string;
  call: string;
  method: string;
  path: string;
}

const sent: Sent[] = [];
let current = { module: "", call: "" };

beforeEach(() => {
  setTokenProvider(() => "token");
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
      const url = new URL(raw, "http://localhost");
      sent.push({ ...current, method: (init?.method ?? "GET").toUpperCase(), path: url.pathname });
      return Promise.resolve(
        new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider(() => null);
});

/** Plausible arguments: ids as strings, bodies and params as objects. */
function argumentsFor(fn: (...args: unknown[]) => unknown): unknown[] {
  return Array.from({ length: Math.max(fn.length, 1) }, (_, index) =>
    index === 0 ? "id-1" : index === 1 ? {} : undefined,
  );
}

describe("every client function", () => {
  it("sends a method and path the backend mounts", async () => {
    for (const [file, exports] of Object.entries(modules)) {
      for (const [name, value] of Object.entries(exports)) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        for (const [key, fn] of Object.entries(value as Record<string, unknown>)) {
          if (typeof fn !== "function") continue;
          current = { module: `${file}:${name}`, call: key };
          try {
            await (fn as (...args: unknown[]) => unknown)(...argumentsFor(fn as (...args: unknown[]) => unknown));
          } catch {
            // A wrapper that needs a real body shape may throw before or
            // after sending; only what reached `fetch` is judged.
          }
        }
      }
    }

    expect(sent.length).toBeGreaterThan(100);
    const unmounted = sent.filter(
      (request) =>
        // The live socket and object storage are not REST endpoints.
        !request.path.endsWith("/live") &&
        !routes.some((route) => route.pattern.test(request.path) && route.methods.has(request.method)),
    );
    expect(unmounted.map((r) => `${r.module}.${r.call}: ${r.method} ${r.path}`)).toEqual([]);
  });
});
