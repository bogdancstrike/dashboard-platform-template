import { afterEach, describe, expect, it, vi } from "vitest";

import { putBytes, type UploadTicket } from "@/api/files";

/**
 * The upload regression (§20, §44): storage that refuses the page's origin
 * (CORS) must not end the upload — the bytes go through the API instead.
 */
type Outcome = { status?: number; error?: boolean; body?: string };

function fakeXhr(outcomes: Outcome[]) {
  const calls: { method: string; url: string; headers: Record<string, string> }[] = [];
  class FakeXhr {
    status = 0;
    responseText = "";
    upload = { addEventListener: (_: string, fn: (e: { lengthComputable: boolean; loaded: number; total: number }) => void) => fn({ lengthComputable: true, loaded: 5, total: 10 }) };
    private handlers: Record<string, (() => void)[]> = {};
    private call = { method: "", url: "", headers: {} as Record<string, string> };
    open(method: string, url: string) {
      this.call = { method, url, headers: {} };
    }
    setRequestHeader(name: string, value: string) {
      this.call.headers[name] = value;
    }
    addEventListener(kind: string, handler: () => void) {
      this.handlers[kind] = [...(this.handlers[kind] ?? []), handler];
    }
    abort() {
      for (const handler of this.handlers["abort"] ?? []) handler();
    }
    send() {
      calls.push(this.call);
      const outcome = outcomes.shift() ?? { status: 200 };
      this.status = outcome.status ?? 0;
      this.responseText = outcome.body ?? "";
      for (const handler of this.handlers[outcome.error ? "error" : "load"] ?? []) handler();
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return calls;
}

const ticket: UploadTicket = {
  file: { id: "f-1" } as UploadTicket["file"],
  upload: { url: "http://localhost:9000/nucleus/key?sig=1", method: "PUT", expires_in: 900, headers: { "Content-Type": "application/pdf" } },
};
const file = new File(["%PDF"], "a.pdf", { type: "application/pdf" });

afterEach(() => vi.unstubAllGlobals());

describe("putBytes", () => {
  it("puts straight to storage when it can", async () => {
    const calls = fakeXhr([{ status: 200 }]);
    const progress = vi.fn();
    await putBytes(ticket, file, progress);
    expect(calls.map((c) => c.method)).toEqual(["PUT"]);
    expect(progress).toHaveBeenCalledWith(0.5);
  });

  it("falls back to the API when the browser blocks the PUT", async () => {
    const calls = fakeXhr([{ error: true }, { status: 200 }]);
    await putBytes(ticket, file, () => {});
    expect(calls[1]).toMatchObject({ method: "POST", url: "/platform/api/files/f-1/content" });
  });

  it("reports a real refusal rather than retrying", async () => {
    fakeXhr([{ status: 403, body: "" }]);
    await expect(putBytes(ticket, file, () => {})).rejects.toThrow("Storage refused the upload (403)");
  });

  it("says why the API refused, and when nothing can be reached", async () => {
    fakeXhr([{ error: true }, { status: 400, body: JSON.stringify({ message: "Too big" }) }]);
    await expect(putBytes(ticket, file, () => {})).rejects.toThrow("Too big");
    fakeXhr([{ error: true }, { error: true }]);
    await expect(putBytes(ticket, file, () => {})).rejects.toThrow("could not reach storage");
  });

  it("can be cancelled", async () => {
    fakeXhr([]);
    const controller = new AbortController();
    controller.abort();
    await expect(putBytes(ticket, file, () => {}, controller.signal)).rejects.toThrow("cancelled");
  });
});
