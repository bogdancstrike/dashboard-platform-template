import { QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AuthProvider } from "@/auth/AuthProvider";
import { CommandProvider } from "@/commands/CommandContext";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { server } from "@/test/server";
import { currentUser } from "@/test/handlers";
import { makeQueryClient } from "@/test/render";
import { AppearanceProvider } from "@/theme/AppearanceProvider";
import { AppShell } from "./AppShell";

function renderShell(route = "/dashboard") {
  return render(
    <QueryClientProvider client={makeQueryClient()}>
      <AppearanceProvider>
        <AntApp>
          <AuthProvider>
            <PreferencesProvider>
              <MemoryRouter initialEntries={[route]}>
                <CommandProvider>
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route path="dashboard" element={<div>Dashboard content</div>} />
                      <Route path="admin" element={<div>Admin content</div>} />
                      {/* A page behind a feature flag (§27), so the shell has
                          something to refuse when the flag is off. */}
                      <Route path="kanban" element={<div>Kanban content</div>} />
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

/**
 * A desktop-width window, for the duration of one test.
 *
 * The suite's `matchMedia` stub answers `false` to everything, so every
 * breakpoint reads as unmet and the shell renders its *mobile* drawer — which
 * is why nothing here had ever exercised the desktop sidebar, and why a
 * responsive rule could collapse it on every ordinary laptop unnoticed.
 * Returns the restore function, so the stub is back to its usual answer before
 * the next test reads it.
 */
function atDesktopWidth(width = 1280): () => void {
  // Bound on the way out rather than stashed as the bare method: a
  // `matchMedia` pulled off `window` and called back later is a method
  // separated from its receiver.
  const restoring = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches =
      (min ? width >= Number(min[1]) : true) && (max ? width <= Number(max[1]) : true);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };
  return () => {
    window.matchMedia = restoring;
  };
}

describe("authenticated application shell", () => {
  it("shows the signed-in profile instead of Guest", async () => {
    const user = userEvent.setup();
    renderShell();

    const profileTrigger = document.querySelector(".nu-user") as HTMLElement;
    expect(profileTrigger.tagName).toBe("BUTTON");
    await user.click(profileTrigger);
    expect(await screen.findByText("Administrator · Northwind Partners")).toBeInTheDocument();
    expect(screen.queryByText("Guest")).not.toBeInTheDocument();
  });

  it("opens with the navigation labelled, whatever the window is (§40)", async () => {
    /**
     * There used to be a responsive rule here: collapsed below the `xl`
     * breakpoint. The effect of it was that on every ordinary laptop — and in
     * jsdom, whose window reports no width at all — the product opened on a
     * rail of unlabelled icons, whatever the reader had chosen on
     * `/settings/preferences`. The preference is the only thing that decides
     * now, which is what makes that switch mean anything.
     */
    const restore = atDesktopWidth();
    try {
      renderShell();
      await waitFor(() => expect(screen.getByText("Dashboard content")).toBeInTheDocument());
      // The words are on screen, not one hover away.
      await waitFor(() =>
        expect(document.querySelector(".ant-layout-sider-collapsed")).toBeNull(),
      );
      // And at the width the labels were measured for: 248 wrapped the longest
      // item in the navigation onto a second line.
      expect((document.querySelector("aside") as HTMLElement).style.width).toBe("272px");
    } finally {
      restore();
    }
  });

  it("collapses when that is what the reader asked for (§40)", async () => {
    server.use(
      http.get("/platform/api/me", () =>
        HttpResponse.json({
          ...currentUser,
          preferences: {
            ...currentUser.preferences,
            appearance: { ...currentUser.preferences.appearance, sidebar_collapsed: true },
          },
        }),
      ),
    );
    const restore = atDesktopWidth();
    try {
      renderShell();
      await waitFor(() =>
        expect(document.querySelector(".ant-layout-sider-collapsed")).not.toBeNull(),
      );
    } finally {
      restore();
    }
  });

  it("hides forbidden navigation and blocks its deep link", async () => {
    server.use(
      http.get("/platform/api/me", () =>
        HttpResponse.json({
          ...currentUser,
          user: { ...currentUser.user, full_name: "Uma User", username: "user" },
          role: { ...currentUser.role, code: "VIEWER", name: "Viewer" },
          permissions: ["records.view"],
        }),
      ),
    );

    renderShell("/admin");

    expect(await screen.findByText("Permission required")).toBeInTheDocument();
    // The permission is *named*, which is the whole point (§76) — "you do not
    // have permission" tells somebody nothing they can go and ask for. It is
    // the shared problem surface now (§34), so the shape of the sentence is
    // asserted where that surface is tested, and this checks the one thing
    // only the shell knows: which permission the route needed.
    expect(screen.getByTestId("problem-missing")).toHaveTextContent("admin.access");
    expect(screen.queryByText("Administration")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin content")).not.toBeInTheDocument();
  });

  it("hides a feature that is switched off, and refuses its address (§27)", async () => {
    // A whole flag system, an administration screen for it, and nothing that
    // read a flag: toggling one changed no navigation and no page. The
    // profile now carries the keys that are on for this reader.
    server.use(
      http.get("/platform/api/me", ({ request }) =>
        HttpResponse.json(
          {
            ...currentUser,
            // The permission is *held*; only the feature is off. That is the
            // whole distinction being asserted — a permission refusal here
            // would prove nothing about flags.
            permissions: [...currentUser.permissions, "tasks.view"],
            // Switched *off*, not merely absent — an absent key means nothing
            // is gating the page, which is the distinction the map exists for.
            features: { ...currentUser.features, "kanban-board": false },
          },
          { headers: { "X-Correlation-Id": request.headers.get("X-Correlation-Id") ?? "" } },
        ),
      ),
    );

    renderShell("/kanban");

    // Not in the menu…
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: /Kanban boards/ })).not.toBeInTheDocument(),
    );
    // …and not reachable by address either, or the menu is one somebody
    // routes around. Said as "switched off" rather than "forbidden": a
    // permission is a fact about the reader, and blaming their role for an
    // administrator's switch is a lie about them.
    expect(await screen.findByTestId("problem-switched_off")).toBeInTheDocument();
  });

  it("does not hide a page whose flag nobody has created (§27)", async () => {
    // The bug this exists for: the client held only *which flags are on*, so
    // an unknown key read as "off" — and a complete, tested page looked
    // deleted. A feature with no flag is not one somebody switched off.
    server.use(
      http.get("/platform/api/me", ({ request }) =>
        HttpResponse.json(
          {
            ...currentUser,
            permissions: [...currentUser.permissions, "tasks.view"],
            // The platform knows about no flags at all.
            features: {},
          },
          { headers: { "X-Correlation-Id": request.headers.get("X-Correlation-Id") ?? "" } },
        ),
      ),
    );

    renderShell("/kanban");

    expect(await screen.findByText("Kanban content")).toBeInTheDocument();
    expect(screen.queryByTestId("problem-switched_off")).not.toBeInTheDocument();
  });
});
