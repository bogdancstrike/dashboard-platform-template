import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";

import { server } from "@/test/server";

import { assistantApi, parseEvents, streamTurn, type TurnEvent } from "./assistant";
import { ApiError } from "./client";

describe("assistant api", () => {
  it("splits server-sent events and keeps the incomplete remainder", () => {
    const { events, rest } = parseEvents(
      'event: delta\ndata: {"text":"Hel"}\n\nevent: delta\ndata: not json\n\n: comment\n\nevent: done\ndata: {"message":',
    );
    expect(events).toEqual([{ type: "delta", text: "Hel" }]);
    expect(rest).toBe('event: done\ndata: {"message":');
    expect(parseEvents('data: {"a":1}\n\n').events).toEqual([{ type: "message", a: 1 }]);
  });

  it("streams a turn event by event", async () => {
    const seen: TurnEvent[] = [];
    await streamTurn("c-1", { content: "Hi" }, (event) => seen.push(event));
    expect(seen.map((e) => e.type)).toEqual(["start", "tool", "tool", "delta", "delta", "done"]);
    expect(seen.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text).join("")).toBe(
      "Hello from the **assistant**.",
    );
  });

  it("reads an event left without a trailing blank line", async () => {
    server.use(
      http.post("/platform/api/assistant/conversations/:id/messages", () =>
        new HttpResponse('event: delta\ndata: {"text":"tail"}', { headers: { "Content-Type": "text/event-stream" } }),
      ),
    );
    const seen: TurnEvent[] = [];
    await streamTurn("c-1", { content: "x" }, (event) => seen.push(event));
    expect(seen).toEqual([{ type: "delta", text: "tail" }]);
  });

  it("turns a refusal into an ApiError with the server's message", async () => {
    server.use(
      http.post("/platform/api/assistant/conversations/:id/messages", () =>
        HttpResponse.json({ error: "rate_limited", message: "Slow down" }, { status: 429 }),
      ),
    );
    await expect(streamTurn("c-1", { content: "x" }, () => undefined)).rejects.toMatchObject({ status: 429, message: "Slow down" });
    server.use(
      http.post("/platform/api/assistant/conversations/:id/messages", () => new HttpResponse("<html>", { status: 502 })),
    );
    const failure = await streamTurn("c-1", { content: "x" }, () => undefined).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).message).toBe("Request failed with 502");
  });

  it("reaches every JSON endpoint", async () => {
    expect((await assistantApi.conversations()).items.length).toBeGreaterThan(0);
    const created = await assistantApi.create({ mode: "data" });
    expect((await assistantApi.get(created.id)).mode).toBe("data");
    expect((await assistantApi.update(created.id, { title: "Renamed" })).title).toBe("Renamed");
    expect((await assistantApi.remove(created.id)).deleted).toBe(true);
    expect((await assistantApi.usage()).tokens).toBe(1234);
    expect((await assistantApi.filters({ resource_type: "auto", question: "open" })).resource_type).toBe("ticket");
    expect((await assistantApi.brief()).items).toHaveLength(2);
    expect((await assistantApi.refreshBrief()).source).toBe("fallback");
    expect((await assistantApi.pageHelp({ path: "/", question: "q", stops: [], controls: [], commands: [] })).answer).toContain("Search");
    expect((await assistantApi.confirmAction({ command_id: "x", label: "X", path: "/" })).recorded).toBe(true);
  });
});
