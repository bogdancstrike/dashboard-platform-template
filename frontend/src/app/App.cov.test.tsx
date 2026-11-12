import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLocation } from "react-router-dom";

import App from "@/App";
import { renderWithProviders } from "@/test/render";

/**
 * The route table (§34, §40): where an address lands, through the real shell.
 *
 * The page tests render their page directly; these render the application,
 * so what is asserted is the table itself — the redirects that keep a
 * bookmark's meaning, the problem pages that have an address, the reader's
 * own landing page, and the catch-all.
 */

function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderApp(route: string) {
  return renderWithProviders(
    <>
      <App />
      <Where />
    </>,
    { route },
  );
}

const where = () => screen.getByTestId("where").textContent ?? "";

describe("the route table", () => {
  it("lands an address-less visit on the reader's own landing page", async () => {
    renderApp("/");
    // The fixture's profile prefers a page; whichever it is, it is not "/".
    await waitFor(() => expect(where()).not.toBe("/"));
  });

  it("keeps a saved search's id through the old bookmark address", async () => {
    renderApp("/search/saved/abc-123");
    await waitFor(() => expect(where()).toBe("/explore?saved=abc-123"));
  });

  it("sends the old search addresses to the explorer", async () => {
    renderApp("/search");
    await waitFor(() => expect(where()).toBe("/explore"));
  });

  it("opens the saved-search panel from its old address", async () => {
    renderApp("/search/saved");
    await waitFor(() => expect(where()).toBe("/explore?panel=saved"));
  });

  it("answers an unknown address with a page that says so", async () => {
    renderApp("/no/such/page");
    expect(await screen.findByRole("heading", { name: "No page answers to that address" })).toBeInTheDocument();
  });

  it.each([
    ["/errors/404", "No page answers to that address"],
    ["/errors/session-expired", "Your session ended"],
    ["/errors/403", "Permission required"],
    ["/errors/401", "You are not signed in"],
    ["/errors/500", "Something broke on this page"],
    ["/errors/maintenance", "The platform is not answering"],
    ["/errors/switched-off", "This feature is switched off"],
  ])("gives %s an address of its own", async (route, title) => {
    renderApp(route);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
  });

  it.each(["/find/catalog", "/find/relationships", "/find/global", "/admin/health", "/showcase/components"])(
    "loads %s on demand inside the shell",
    async (route) => {
      renderApp(route);
      // The shell is there at once; the page arrives when its chunk does.
      expect(await screen.findAllByRole("navigation", { name: "Main" })).not.toHaveLength(0);
      await waitFor(() => expect(document.querySelector(".ant-skeleton")).toBeNull(), {
        timeout: 10_000,
      });
      expect(where()).toBe(route);
    },
  );
});

describe("renamed addresses", () => {
  it("sends the old system page to health", async () => {
    renderApp("/system");
    await waitFor(() => expect(where()).toBe("/admin/health"));
  });
});
