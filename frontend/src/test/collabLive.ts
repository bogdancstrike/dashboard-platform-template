/**
 * A stand-in for the live channel in component tests (§47): pages subscribe
 * through `useLiveEvents`, and a test plays the server with `emitLive`.
 *
 *     vi.mock("@/live/LiveProvider", async (original) => ({
 *       ...(await original<typeof import("@/live/LiveProvider")>()),
 *       useLiveEvents: (await import("@/test/collabLive")).useMockLiveEvents,
 *     }));
 */
import { act } from "@testing-library/react";
import { useEffect, useRef } from "react";

import type { LiveMessage } from "@/live/LiveProvider";

const listeners = new Set<(message: LiveMessage) => void>();

export function useMockLiveEvents(handler: (message: LiveMessage) => void): void {
  const current = useRef(handler);
  current.current = handler;
  useEffect(() => {
    const listener = (message: LiveMessage) => current.current(message);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
}

export function emitLive(message: LiveMessage): void {
  act(() => {
    for (const listener of listeners) listener(message);
  });
}
