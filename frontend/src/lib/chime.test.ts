import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The notification sound (§17, §40): two notes, made on one shared context,
 * and silence rather than an exception whenever the browser will not play.
 */

function fakeContext(state: "running" | "suspended" = "suspended") {
  const oscillators: { frequency: { value: number }; start: ReturnType<typeof vi.fn> }[] = [];
  const ctx = {
    state,
    currentTime: 1,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => {
      const oscillator = {
        type: "",
        frequency: { value: 0 },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    })),
  };
  return { ctx, oscillators };
}

async function freshChime() {
  vi.resetModules();
  return (await import("./chime")).chime;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chime", () => {
  it("plays two notes a fifth apart, resuming a suspended context once", async () => {
    const { ctx, oscillators } = fakeContext();
    let constructed = 0;
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          constructed += 1;
          return ctx;
        }
      },
    );
    const chime = await freshChime();
    chime();
    chime();
    expect(constructed).toBe(1);
    expect(ctx.resume).toHaveBeenCalled();
    expect(oscillators.slice(0, 2).map((item) => item.frequency.value)).toEqual([880, 1318.5]);
    expect(oscillators[0]!.start).toHaveBeenCalledWith(1);
  });

  it("is silent where there is no audio at all", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const chime = await freshChime();
    expect(() => chime()).not.toThrow();
  });

  it("is silent rather than throwing when the browser refuses", async () => {
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          throw new Error("not allowed");
        }
      },
    );
    const refused = await freshChime();
    expect(() => refused()).not.toThrow();

    const { ctx } = fakeContext("running");
    ctx.createOscillator = vi.fn(() => {
      throw new Error("closed");
    });
    vi.stubGlobal(
      "AudioContext",
      class {
        constructor() {
          return ctx;
        }
      },
    );
    const broken = await freshChime();
    expect(() => broken()).not.toThrow();
    expect(ctx.resume).not.toHaveBeenCalled();
  });
});
