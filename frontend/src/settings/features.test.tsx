/**
 * Feature flags in the browser (§27): which flag a path is behind, parents,
 * the gate components, and the sync that keeps the map current without a
 * reload — on the live channel, on a `feature_disabled` refusal, and on a poll.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, setFeatureDisabledHandler, ApiError } from "@/api/client";
import { currentUser } from "@/test/handlers";
import { emitLive } from "@/test/collabLive";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";
import {
  FEATURES,
  Feature,
  FEATURE_POLL_MS,
  ROUTE_FLAGS,
  featureOn,
  flagForPath,
  navItemFlag,
  useFeature,
  useFeatureSync,
  useFeatures,
  withFeature,
} from "./features";

vi.mock("@/live/LiveProvider", async (original) => ({
  ...(await original<typeof import("@/live/LiveProvider")>()),
  useLiveEvents: (await import("@/test/collabLive")).useMockLiveEvents,
  useLive: () => liveState,
}));

const liveState = { status: "live", shouldPoll: false, received: 0, subscribe: () => () => undefined };

function profileWith(features: Record<string, boolean>) {
  server.use(http.get("/platform/api/me", () => HttpResponse.json({ ...currentUser, features })));
}

afterEach(() => {
  liveState.shouldPoll = false;
  setFeatureDisabledHandler(null);
});

describe("which flag a path is behind", () => {
  it("matches static and parameterised routes, preferring the static one", () => {
    expect(flagForPath("/time")).toBe("time-tracking");
    expect(flagForPath("/chat/abc-123")).toBe("chat");
    expect(flagForPath("/workflows/9/canvas")).toBe("workflow-canvas");
    expect(flagForPath("/workflows")).toBe("workflows");
    expect(flagForPath("/customers/health")).toBe("customer-health");
    expect(flagForPath("/customers/grid")).toBe("spreadsheet-grid");
    expect(flagForPath("/customers/123")).toBeUndefined();
    expect(flagForPath("/dashboard")).toBeUndefined();
    expect(flagForPath("/admin/flags")).toBeUndefined();
  });

  it("knows every route the catalogue declares", () => {
    for (const [route, key] of Object.entries(ROUTE_FLAGS)) {
      expect(flagForPath(route.replace(/:[A-Za-z]+/g, "x1"))).toBe(key);
    }
  });

  it("gives a nav item its own flag, or its route's", () => {
    expect(navItemFlag({ key: "/kanban" })).toBe("kanban-board");
    expect(navItemFlag({ key: "/developers/console" })).toBe("developer-portal");
    expect(navItemFlag({ key: "/x", flag: "maps" })).toBe("maps");
    expect(navItemFlag({ key: "/home" })).toBeUndefined();
  });
});

describe("whether a feature is on", () => {
  it("reads an absent key, or no map at all, as ungated", () => {
    expect(featureOn(undefined, FEATURES.chat)).toBe(true);
    expect(featureOn({}, FEATURES.chat)).toBe(true);
    expect(featureOn({ chat: false }, FEATURES.chat)).toBe(false);
  });

  it("turns a child off with its parent", () => {
    expect(featureOn({ ai: false }, FEATURES.aiAssistant)).toBe(false);
    expect(featureOn({ ai: true, "ai-assistant": true }, FEATURES.aiAssistant)).toBe(true);
    expect(featureOn({ workflows: false }, FEATURES.workflowCanvas)).toBe(false);
  });
});

function Probe() {
  const chat = useFeature(FEATURES.chat);
  const features = useFeatures();
  return (
    <div>
      <span data-testid="chat">{String(chat)}</span>
      <span data-testid="maps">{String(features(FEATURES.maps))}</span>
      <Feature flag={FEATURES.chat} fallback={<span>chat is off</span>}>
        <span>chat is on</span>
      </Feature>
    </div>
  );
}

const Gated = withFeature(FEATURES.timeTracking, ({ label }: { label: string }) => <span>{label}</span>);

describe("the gates", () => {
  it("are ungated outside an AuthProvider", () => {
    render(<Probe />);
    expect(screen.getByTestId("chat")).toHaveTextContent("true");
    expect(screen.getByText("chat is on")).toBeInTheDocument();
    render(<Gated label="timer" />);
    expect(screen.getByText("timer")).toBeInTheDocument();
  });

  it("follow the profile's map", async () => {
    profileWith({ chat: false, maps: true, "time-tracking": false });
    renderWithProviders(
      <>
        <Probe />
        <Gated label="timer" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("false"));
    expect(screen.getByTestId("maps")).toHaveTextContent("true");
    expect(screen.getByText("chat is off")).toBeInTheDocument();
    expect(screen.queryByText("timer")).not.toBeInTheDocument();
    expect(Gated.displayName).toContain("time-tracking");
  });
});

function Synced() {
  useFeatureSync();
  return <Probe />;
}

describe("keeping the map current without a reload", () => {
  it("refetches the profile when the server announces a flag change", async () => {
    profileWith({ chat: true });
    renderWithProviders(<Synced />);
    await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("true"));

    profileWith({ chat: false });
    emitLive({ type: "features.changed" });
    await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("false"));
  });

  it("refetches when any call comes back feature_disabled", async () => {
    profileWith({ chat: true });
    server.use(
      http.get("/platform/api/chat/channels", () =>
        HttpResponse.json({ error: "feature_disabled", feature: "chat", message: "Team chat is switched off." }, { status: 404 }),
      ),
    );
    renderWithProviders(<Synced />);
    await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("true"));

    profileWith({ chat: false });
    const failure = await api.get("/api/chat/channels").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).isFeatureDisabled).toBe(true);
    expect((failure as ApiError).feature).toBe("chat");
    await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("false"));
  });

  it("polls while the live channel is down", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      liveState.shouldPoll = true;
      profileWith({ chat: true });
      renderWithProviders(<Synced />);
      await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("true"));
      profileWith({ chat: false });
      act(() => {
        vi.advanceTimersByTime(FEATURE_POLL_MS + 10);
      });
      await waitFor(() => expect(screen.getByTestId("chat")).toHaveTextContent("false"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("an ApiError without a feature says so", () => {
    const error = new ApiError(404, { error: "not_found", message: "gone" }, "c");
    expect(error.isFeatureDisabled).toBe(false);
    expect(error.feature).toBeUndefined();
  });
});
