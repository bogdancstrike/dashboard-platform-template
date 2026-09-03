import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { CORRELATION_HEADER } from "@/config";
import { server } from "@/test/server";

import { ApiError, api, buildQuery, request, setTokenProvider } from "./client";

describe("buildQuery", () => {
  it("drops empty values rather than sending them", () => {
    // An empty filter must not narrow anything. `?status=` reaching the server
    // would be a filter on the empty string.
    expect(buildQuery({ a: 1, b: "", c: null, d: undefined, e: "x" })).toBe("?a=1&e=x");
  });

  it("joins arrays with commas, which is what the backend splits on", () => {
    expect(buildQuery({ status: ["ACTIVE", "SUSPENDED"] })).toBe("?status=ACTIVE%2CSUSPENDED");
  });

  it("drops an array that is empty once blanks are removed", () => {
    expect(buildQuery({ status: ["", null] as unknown as string[] })).toBe("");
  });

  it("returns nothing for no params", () => {
    expect(buildQuery(undefined)).toBe("");
    expect(buildQuery({})).toBe("");
  });
});

describe("request", () => {
  it("sends a correlation id on every request", async () => {
    let seen: string | null = null;
    server.use(
      http.get("/platform/ping", ({ request: req }) => {
        seen = req.headers.get(CORRELATION_HEADER);
        return HttpResponse.json({ ok: true });
      }),
    );

    await api.get("/ping");
    expect(seen).toMatch(/^[0-9a-f]{32}$/);
  });

  it("prefers the id the server echoed back", async () => {
    server.use(
      http.get("/platform/boom", () =>
        HttpResponse.json(
          { error: "conflict", message: "nope" },
          { status: 409, headers: { [CORRELATION_HEADER]: "server-side-id" } },
        ),
      ),
    );

    // The echoed value is the one the server logged against, so it is the one
    // worth putting on an error screen.
    await expect(api.get("/boom")).rejects.toMatchObject({ correlationId: "server-side-id" });
  });

  it("turns the error envelope into an ApiError", async () => {
    server.use(
      http.get("/platform/denied", () =>
        HttpResponse.json(
          {
            error: "forbidden",
            message: "You do not have permission to perform this action.",
            details: { missing: ["records.export"], missing_labels: ["Export records"] },
          },
          { status: 403 },
        ),
      ),
    );

    const error = await api.get("/denied").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.code).toBe("forbidden");
    expect(apiError.isForbidden).toBe(true);
    expect(apiError.isUnauthorized).toBe(false);
    expect(apiError.missingPermissions).toEqual(["Export records"]);
  });

  it("survives a non-JSON error body", async () => {
    server.use(
      http.get("/platform/html", () =>
        HttpResponse.text("<html>gateway timeout</html>", { status: 504 }),
      ),
    );

    const error = (await api.get("/html").catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(504);
  });

  it("returns undefined for 204 rather than trying to parse it", async () => {
    server.use(http.delete("/platform/thing", () => new HttpResponse(null, { status: 204 })));
    await expect(api.delete("/thing")).resolves.toBeUndefined();
  });

  it("attaches the bearer token when one is available", async () => {
    let authorization: string | null = null;
    server.use(
      http.get("/platform/secure", ({ request: req }) => {
        authorization = req.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    setTokenProvider(() => "a-token");
    await api.get("/secure");
    setTokenProvider(() => null);

    expect(authorization).toBe("Bearer a-token");
  });

  it("sends no Authorization header when there is no token", async () => {
    let authorization: string | null = "unset";
    server.use(
      http.get("/platform/open", ({ request: req }) => {
        authorization = req.headers.get("Authorization");
        return HttpResponse.json({ ok: true });
      }),
    );

    await api.get("/open");
    expect(authorization).toBeNull();
  });

  it("can be cancelled", async () => {
    server.use(http.get("/platform/slow", () => HttpResponse.json({ ok: true })));
    const controller = new AbortController();
    controller.abort();
    await expect(request("/slow", { signal: controller.signal })).rejects.toThrow();
  });
});
