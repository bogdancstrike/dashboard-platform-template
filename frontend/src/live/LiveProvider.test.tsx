import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "@/api/client";
import { makeQueryClient } from "@/test/render";

import { LiveProvider, useLive, usePollInterval } from "./LiveProvider";

/**
 * The live channel (§17): one socket, a status the rest of the app polls by,
 * and toasts that are a nudge rather than a flood.
 *
 * jsdom has no WebSocket, so a fake one records what the provider did with it
 * and lets the test play the server's part — open, message, close.
 */

const preferences = {
  notifications: {
    popups: "all" as "all" | "important" | "none",
    popup_categories: [] as string[],
    sound: false,
    popup_seconds: 4,
    popup_placement: "bottomRight",
    popup_style: "full" as "full" | "compact",
  },
};

vi.mock("@/settings/PreferencesProvider", () => ({
  usePreferences: () => ({ preferences }),
}));

const chime = vi.fn<() => void>();
vi.mock("@/lib/chime", () => ({
  chime: () => {
    chime();
  },
}));

class FakeSocket {
  static instances: FakeSocket[] = [];
  static throwOnCreate = false;
  url: string;
  protocols: string[];
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string, protocols: string[]) {
    if (FakeSocket.throwOnCreate) throw new Error("blocked by a proxy");
    this.url = url;
    this.protocols = protocols;
    FakeSocket.instances.push(this);
  }

  send(message: string) {
    this.sent.push(message);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

function Probe() {
  const live = useLive();
  const interval = usePollInterval(30_000);
  return (
    <div>
      <span data-testid="status">{live.status}</span>
      <span data-testid="received">{live.received}</span>
      <span data-testid="interval">{String(interval)}</span>
    </div>
  );
}

function renderLive() {
  const client = makeQueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <AntApp>
        <LiveProvider>
          <Probe />
        </LiveProvider>
      </AntApp>
    </QueryClientProvider>,
  );
  return { ...view, invalidate };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function notification(id: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: "notification",
    data: {
      id,
      title: `Title ${id}`,
      body: `Body ${id}`,
      severity: "WARNING",
      category: "SYSTEM",
      ...extra,
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  FakeSocket.instances = [];
  FakeSocket.throwOnCreate = false;
  vi.stubGlobal("WebSocket", FakeSocket);
  setTokenProvider(() => "token-123");
  Object.assign(preferences.notifications, {
    popups: "all",
    popup_categories: [],
    sound: false,
    popup_style: "full",
  });
  chime.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setTokenProvider(() => null);
});

describe("the live channel", () => {
  it("polls until the socket opens, then stops polling", async () => {
    const { invalidate } = renderLive();
    await flush();
    expect(screen.getByTestId("status")).toHaveTextContent("connecting");
    expect(screen.getByTestId("interval")).toHaveTextContent("30000");

    const socket = FakeSocket.instances[0]!;
    // The bearer token rides in the subprotocol, the one header a browser allows.
    expect(socket.protocols).toEqual(["bearer", "token-123"]);
    expect(socket.url).toMatch(/^ws.*\/live$/);

    act(() => socket.onopen?.());
    expect(screen.getByTestId("status")).toHaveTextContent("live");
    expect(screen.getByTestId("interval")).toHaveTextContent("false");
    // A fresh socket asks for the truth rather than assuming it is current.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["notifications"] });
  });

  it("answers a ping and ignores what it cannot read", async () => {
    renderLive();
    await flush();
    const socket = FakeSocket.instances[0]!;
    act(() => socket.onopen?.());

    act(() => socket.onmessage?.({ data: "ping" }));
    expect(socket.sent).toEqual(["pong"]);
    act(() => socket.onmessage?.({ data: "{not json" }));
    act(() => socket.onmessage?.({ data: JSON.stringify({ type: "other" }) }));
    expect(screen.getByTestId("received")).toHaveTextContent("0");
  });

  it("delivers a notification as a toast, and only three at once", async () => {
    preferences.notifications.sound = true;
    renderLive();
    await flush();
    const socket = FakeSocket.instances[0]!;
    act(() => socket.onopen?.());

    for (const id of ["a", "b", "c", "d", "e"]) {
      act(() => socket.onmessage?.({ data: notification(id) }));
    }
    expect(screen.getByTestId("received")).toHaveTextContent("5");
    expect(chime).toHaveBeenCalledTimes(5);
    expect(await screen.findByText("Title a")).toBeInTheDocument();
    expect(screen.getByText("Body a")).toBeInTheDocument();
    // The fourth and fifth are counted in one card rather than drawn.
    expect(await screen.findByText("2 more notifications")).toBeInTheDocument();
    expect(screen.queryByText("Title d")).not.toBeInTheDocument();
  });

  it("respects the reader's pop-up settings", async () => {
    renderLive();
    await flush();
    const socket = FakeSocket.instances[0]!;
    act(() => socket.onopen?.());

    preferences.notifications.popups = "none";
    act(() => socket.onmessage?.({ data: notification("quiet") }));
    preferences.notifications.popups = "important";
    act(() => socket.onmessage?.({ data: notification("info", { severity: "INFO" }) }));
    preferences.notifications.popups = "all";
    preferences.notifications.popup_categories = ["MAIL"];
    act(() => socket.onmessage?.({ data: notification("wrong-category") }));
    preferences.notifications.popup_categories = [];
    preferences.notifications.popup_style = "compact";
    act(() => socket.onmessage?.({ data: notification("compact") }));

    // Every one still counts — the badge always updates.
    expect(screen.getByTestId("received")).toHaveTextContent("4");
    expect(await screen.findByText("Title compact")).toBeInTheDocument();
    expect(screen.queryByText("Body compact")).not.toBeInTheDocument();
    expect(screen.queryByText("Title quiet")).not.toBeInTheDocument();
    expect(screen.queryByText("Title info")).not.toBeInTheDocument();
    expect(screen.queryByText("Title wrong-category")).not.toBeInTheDocument();
  });

  it("reconnects with backoff after the socket drops", async () => {
    renderLive();
    await flush();
    const first = FakeSocket.instances[0]!;
    act(() => first.onopen?.());
    act(() => first.onerror?.());
    expect(screen.getByTestId("status")).toHaveTextContent("polling");
    act(() => first.close());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flush();
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("treats a silent socket as dead", async () => {
    renderLive();
    await flush();
    const socket = FakeSocket.instances[0]!;
    act(() => socket.onopen?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(90_000);
    });
    expect(socket.closed).toBe(true);
    expect(screen.getByTestId("status")).toHaveTextContent("polling");
  });

  it("polls when there is no token yet, or the socket cannot be built", async () => {
    setTokenProvider(() => null);
    renderLive();
    await flush();
    expect(screen.getByTestId("status")).toHaveTextContent("polling");
    expect(FakeSocket.instances).toHaveLength(0);

    setTokenProvider(() => "later");
    FakeSocket.throwOnCreate = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await flush();
    expect(screen.getByTestId("status")).toHaveTextContent("polling");
  });

  it("closes its socket when it unmounts, without reconnecting", async () => {
    const { unmount } = renderLive();
    await flush();
    const socket = FakeSocket.instances[0]!;
    unmount();
    expect(socket.closed).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("outside the provider, says to poll", () => {
    render(<Probe />);
    expect(screen.getByTestId("status")).toHaveTextContent("polling");
  });
});
