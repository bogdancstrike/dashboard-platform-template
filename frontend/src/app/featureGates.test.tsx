/**
 * Switched-off features vanish from the UI (§27): menu entries and the group
 * headings they leave empty, routes reached by address (including ones no menu
 * entry names), header chrome, the palette, its shortcut, and widget kinds.
 */

import { QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "@/auth/AuthProvider";
import { CommandProvider, useCommands } from "@/commands/CommandContext";
import { kindFlag } from "@/components/dashboards/kinds";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { server } from "@/test/server";
import { currentUser } from "@/test/handlers";
import { makeQueryClient } from "@/test/render";
import { AppearanceProvider } from "@/theme/AppearanceProvider";
import { AppShell } from "./AppShell";

const ALL_PERMISSIONS = [
  ...currentUser.permissions,
  "tasks.view", "time.track", "chat.use", "docs.view", "ai.use", "automations.manage", "records.view",
];

function withFeatures(features: Record<string, boolean>) {
  server.use(
    http.get("/platform/api/me", () =>
      HttpResponse.json({ ...currentUser, permissions: ALL_PERMISSIONS, features }),
    ),
  );
}

function OpenState() {
  const { open } = useCommands();
  return <span data-testid="palette-open">{String(open)}</span>;
}

function renderShell(route: string) {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <AppearanceProvider>
        <AntApp>
          <AuthProvider>
            <PreferencesProvider>
              <MemoryRouter initialEntries={[route]}>
                <CommandProvider>
                  <OpenState />
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="dashboard" element={<div>Dashboard content</div>} />
                      <Route path="time" element={<div>Time content</div>} />
                      <Route path="tasks/grid" element={<div>Grid content</div>} />
                      <Route path="workflows/:id/canvas" element={<div>Canvas content</div>} />
                      <Route path="assistant/:id" element={<div>Conversation content</div>} />
                    </Route>
                  </Routes>
                </CommandProvider>
              </MemoryRouter>
            </PreferencesProvider>
          </AuthProvider>
        </AntApp>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}

function atDesktopWidth(): () => void {
  const restoring = window.matchMedia.bind(window);
  window.matchMedia = ((query: string) => ({
    matches: /min-width:\s*(\d+)/.test(query) ? Number(/min-width:\s*(\d+)/.exec(query)?.[1]) <= 1440 : false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
  return () => {
    window.matchMedia = restoring;
  };
}

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe("a route whose feature is off", () => {
  it.each([
    ["/time", "time-tracking", "Time content"],
    ["/tasks/grid", "spreadsheet-grid", "Grid content"],
    ["/workflows/abc/canvas", "workflow-canvas", "Canvas content"],
    ["/assistant/abc", "ai", "Conversation content"],
  ])("%s shows the switched-off page when %s is off", async (route, flag, content) => {
    withFeatures({ [flag]: false });
    renderShell(route);
    expect(await screen.findByTestId("problem-switched_off")).toBeInTheDocument();
    expect(screen.queryByText(content)).not.toBeInTheDocument();
  });

  it("renders as usual when the feature is on", async () => {
    withFeatures({ "time-tracking": true });
    renderShell("/time");
    expect(await screen.findByText("Time content")).toBeInTheDocument();
  });
});

describe("the menu and the header", () => {
  it("drops entries, and a heading left with nothing under it", async () => {
    restore = atDesktopWidth();
    withFeatures({
      ai: false,
      "time-tracking": false,
      chat: false,
      "kanban-board": false,
      "developer-portal": false,
      "live-updates": false,
      "command-palette": false,
      "dark-mode": false,
    });
    renderShell("/dashboard");
    expect(await screen.findByText("Dashboard content")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /Kanban boards/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("menuitem", { name: /Time & timesheets/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /^Chat/ })).not.toBeInTheDocument();
    // The AI and Developers groups are empty, so their headings go too.
    expect(screen.queryByText("Developers")).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Assistant/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("live-status")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open the command palette/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Switch to (dark|light)/ })).not.toBeInTheDocument();
    // Still there: the menu entries no flag governs.
    expect(screen.getAllByText("Notifications").length).toBeGreaterThan(0);
  });

  it("keeps them all when every feature is on", async () => {
    restore = atDesktopWidth();
    withFeatures({});
    renderShell("/dashboard");
    expect(await screen.findByText("Dashboard content")).toBeInTheDocument();
    expect(await screen.findByTestId("live-status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Open the command palette/ })).toBeInTheDocument();
  });
});

describe("the palette shortcut", () => {
  it("is left to the browser while the palette is switched off", async () => {
    withFeatures({ "command-palette": false });
    renderShell("/dashboard");
    await screen.findByText("Dashboard content");
    await waitFor(() => expect(screen.getByTestId("palette-open")).toHaveTextContent("false"));
    // Give the profile a moment to land, then press the chord.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByTestId("palette-open")).toHaveTextContent("false");
  });

  it("opens it while it is on", async () => {
    withFeatures({});
    renderShell("/dashboard");
    await screen.findByText("Dashboard content");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId("palette-open")).toHaveTextContent("true"));
  });
});

describe("dashboard widget kinds", () => {
  it("belong to the flag of the page they open", () => {
    expect(kindFlag("INSIGHT")).toBe("ai-insights");
    expect(kindFlag("SEARCH")).toBe("saved-views");
    expect(kindFlag("MAP")).toBe("maps");
    expect(kindFlag("ACTIVITY")).toBeUndefined();
  });
});
