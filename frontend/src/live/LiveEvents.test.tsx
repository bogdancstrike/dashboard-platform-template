import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { App as AntApp } from "antd";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "@/api/client";
import { makeQueryClient } from "@/test/render";

import { LiveProvider, useLiveEvents, type LiveMessage } from "./LiveProvider";

/**
 * The live channel's hints (§47): any message reaches every subscriber, and
 * the browser reports its own presence — away when hidden, online when back.
 */

vi.mock("@/settings/PreferencesProvider", () => ({
  usePreferences: () => ({
    preferences: { notifications: { popups: "none", popup_categories: [], sound: false, popup_seconds: 4, popup_placement: "bottomRight", popup_style: "full" } },
  }),
}));

class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor() {
    FakeSocket.last = this;
  }
  send(message: string) {
    this.sent.push(message);
  }
  close() {
    this.onclose?.();
  }
}

function Listener() {
  const [seen, setSeen] = useState<string[]>([]);
  useLiveEvents((message: LiveMessage) => setSeen((all) => [...all, String(message.type)]));
  return <span data-testid="seen">{seen.join(",")}</span>;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
  setTokenProvider(() => "token");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setTokenProvider(() => null);
  setHidden(false);
});

describe("live hints", () => {
  it("hands every message to subscribers and reports presence changes", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AntApp>
          <LiveProvider>
            <Listener />
          </LiveProvider>
        </AntApp>
      </QueryClientProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const socket = FakeSocket.last!;
    act(() => socket.onopen?.());
    act(() => socket.onmessage?.({ data: JSON.stringify({ type: "typing", resource_id: "x" }) }));
    act(() => socket.onmessage?.({ data: JSON.stringify({ type: "presence", user_id: "u", status: "away" }) }));
    act(() => socket.onmessage?.({ data: "not json" }));
    expect(screen.getByTestId("seen")).toHaveTextContent("typing,presence");

    act(() => setHidden(true));
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "presence", status: "away" }));
    act(() => setHidden(false));
    expect(socket.sent.at(-1)).toBe(JSON.stringify({ type: "presence", status: "online" }));
  });
});
