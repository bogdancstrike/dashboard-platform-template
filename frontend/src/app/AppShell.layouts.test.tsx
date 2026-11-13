import { QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { AuthProvider } from "@/auth/AuthProvider";
import { STORAGE_KEYS } from "@/config";
import { CommandProvider } from "@/commands/CommandContext";
import { PreferencesProvider } from "@/settings/PreferencesProvider";
import { makeQueryClient } from "@/test/render";
import { AppearanceProvider } from "@/theme/AppearanceProvider";

import { AppShell } from "./AppShell";

/**
 * The shell's three layouts (§1): the phone's tabs and "More" sheet, the
 * tablet's rail and chips, and the desktop sidebar's groups, fold and menus.
 *
 * `AppShell.test.tsx` covers what is the same in all three — the profile,
 * permissions, flags. These cover what is different, found by role and label.
 */

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname}</output>;
}

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
                      <Route path="*" element={<div>Page content</div>} />
                    </Route>
                  </Routes>
                  <Where />
                </CommandProvider>
              </MemoryRouter>
            </PreferencesProvider>
          </AuthProvider>
        </AntApp>
      </AppearanceProvider>
    </QueryClientProvider>,
  );
}

let restoreMedia: (() => void) | null = null;

/** A window of the given width, as AntD's breakpoint observer reads it. */
function atWidth(width: number) {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    const matches = (min ? width >= Number(min[1]) : true) && (max ? width <= Number(max[1]) : true);
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
  restoreMedia = () => {
    window.matchMedia = original;
  };
}

const where = () => screen.getByTestId("where").textContent;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  restoreMedia?.();
  restoreMedia = null;
});

describe("on a phone", () => {
  it("has a tab bar whose tab owns the section it is in", async () => {
    renderShell("/tasks");
    const tabs = await screen.findByRole("navigation", { name: "Main" });
    expect(within(tabs).getByRole("link", { name: /Work/ })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: /Home/ })).not.toHaveAttribute("aria-current");
  });

  it("opens the whole navigation in a sheet, and closes it on the way somewhere", async () => {
    const user = userEvent.setup();
    renderShell("/dashboard");
    await user.click(await screen.findByRole("button", { name: "More navigation" }));
    const sheet = await screen.findByRole("dialog", { name: "Navigation" });
    expect(screen.getByRole("button", { name: "More navigation" })).toHaveAttribute("aria-expanded", "true");

    // The close button closes it…
    await user.click(within(sheet).getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument();

    // …and so does going somewhere from it.
    await user.click(screen.getByRole("button", { name: "More navigation" }));
    const again = await screen.findByRole("dialog", { name: "Navigation" });
    const [first] = within(again).getAllByRole("link");
    const target = first!.getAttribute("href");
    await user.click(first!);
    await waitFor(() => expect(where()).toBe(target));
    expect(screen.queryByRole("dialog", { name: "Navigation" })).not.toBeInTheDocument();
  });

  it("has the palette and the profile menu in the top bar", async () => {
    const user = userEvent.setup();
    renderShell("/dashboard");
    await user.click(await screen.findByRole("button", { name: "Open profile menu" }));
    await user.click(await screen.findByText("Your profile"));
    await waitFor(() => expect(where()).toBe("/profile"));
    expect(screen.getByRole("button", { name: "Open the command palette" })).toBeInTheDocument();
  });
});

describe("on a tablet", () => {
  it("shows a rail of sections and the current section's pages as chips", async () => {
    atWidth(1000);
    const user = userEvent.setup();
    renderShell("/dashboard");
    const rail = await screen.findByRole("navigation", { name: "Sections" });
    const current = within(rail).getAllByRole("link").find((link) => link.getAttribute("aria-current") === "true");
    expect(current).toBeDefined();

    const chips = screen.getByRole("navigation", { name: current!.getAttribute("aria-label")! });
    const here = within(chips).getByRole("link", { current: "page" });
    expect(here).toHaveAttribute("href", "/dashboard");

    // The button flips whichever mode is showing.
    const before = document.documentElement.style.colorScheme === "dark" ? "dark" : "light";
    await user.click(screen.getByRole("button", { name: "Toggle theme" }));
    await waitFor(() =>
      expect(window.localStorage.getItem(STORAGE_KEYS.appearance)).toBe(before === "dark" ? "light" : "dark"),
    );
  });
});

describe("on a desktop", () => {
  it("folds and unfolds the sidebar, remembering it", async () => {
    atWidth(1400);
    const user = userEvent.setup();
    renderShell("/dashboard");
    await user.click(await screen.findByRole("button", { name: "Collapse sidebar" }));
    expect(await screen.findByRole("button", { name: "Expand sidebar" })).toBeInTheDocument();
    expect(window.localStorage.getItem(STORAGE_KEYS.sidebarCollapsed)).toBe("true");
    await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
    expect(await screen.findByRole("button", { name: "Collapse sidebar" })).toBeInTheDocument();
  });

  it("closes a navigation group and remembers which", async () => {
    atWidth(1400);
    const user = userEvent.setup();
    renderShell("/dashboard");
    const menu = await screen.findByRole("menu", { name: "Pages" });
    const [head] = within(menu).getAllByRole("menuitem").filter((item) => item.hasAttribute("aria-expanded"));
    expect(head).toHaveAttribute("aria-expanded", "true");
    await user.click(head!);
    expect(head).toHaveAttribute("aria-expanded", "false");
    expect(JSON.parse(window.localStorage.getItem("nu.nav.closed") ?? "[]")).toHaveLength(1);
    await user.click(head!);
    expect(head).toHaveAttribute("aria-expanded", "true");
  });

  it("reopens with the groups that were closed last time", async () => {
    atWidth(1400);
    window.localStorage.setItem("nu.nav.closed", JSON.stringify(["overview", 7]));
    renderShell("/dashboard");
    await screen.findByRole("menu", { name: "Pages" });
    window.localStorage.setItem("nu.nav.closed", "{not json");
  });

  it("offers preferences, security and appearance from the profile menu", async () => {
    atWidth(1400);
    const user = userEvent.setup();
    renderShell("/dashboard");
    await user.click(await screen.findByRole("button", { name: "Open profile menu" }));
    await user.click(await screen.findByText(/Appearance:/));
    await user.click(screen.getByRole("button", { name: "Open profile menu" }));
    await user.click(await screen.findByText("Security"));
    await waitFor(() => expect(where()).toBe("/settings/security"));
    await user.click(screen.getByRole("button", { name: "Open profile menu" }));
    await user.click(await screen.findByText("Preferences"));
    await waitFor(() => expect(where()).toBe("/settings/preferences"));
  });
});
