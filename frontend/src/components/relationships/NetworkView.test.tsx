import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { NetworkView } from "@/components/relationships/NetworkView";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

function render(overrides: Partial<Parameters<typeof NetworkView>[0]> = {}) {
  return renderWithProviders(
    <NetworkView focus="customer" onFocus={vi.fn()} onExplore={vi.fn()} {...overrides} />,
  );
}

describe("community analysis", () => {
  it("draws the clustered graph and names every cluster beside it", async () => {
    render();

    // The picture…
    expect(await screen.findByTestId("force-graph")).toBeInTheDocument();
    // …and the list, which is what a reader can actually act on.
    const clusters = screen.getByTestId("community-list");
    expect(within(clusters).getByText("Northwind Partners")).toBeInTheDocument();
    expect(within(clusters).getByText("Stonebridge Group")).toBeInTheDocument();
    expect(
      within(clusters).getByText("1 customers · 1 orders · 1 tickets · 1 users"),
    ).toBeInTheDocument();
  });

  it("describes the whole picture for a reader who cannot see it", async () => {
    render();

    // §55: the SVG names the whole picture, so a reader who cannot see it
    // gets the finding rather than a shape count.
    //
    // A `group` and not an `img`: this comment used to claim the opposite —
    // "one image, not sixty focusable circles" — and the circles have been
    // focusable `role="button"` nodes all along, which is `nested-interactive`
    // and a screen reader that announces the summary and then hides the graph
    // it summarises. Found by auditing every route at once.
    const picture = await screen.findByRole("group", { name: /6 records in 2 communities/ });
    expect(picture).toHaveAccessibleName(/1 of which cross between communities/);
    expect(picture).toHaveAccessibleName(/largest is Northwind Partners/);
  });

  it("says how much of the structure is real rather than implying certainty", async () => {
    render();

    // Newman's Q, shipped by the server and shown without interpretation
    // beyond the threshold everybody uses.
    expect(await screen.findByTestId("modularity")).toHaveTextContent("Q 0.42");
  });

  it("counts what the server clustered, not what fits on the canvas", async () => {
    render();

    await screen.findByTestId("force-graph");
    expect(screen.getByText("Communities")).toBeInTheDocument();
    expect(screen.getByText("Bridges")).toBeInTheDocument();
    // One link crosses between the two clusters — the shared account manager.
    const tiles = screen.getByText("Bridges").closest(".ant-card")!;
    expect(within(tiles as HTMLElement).getByText("1")).toBeInTheDocument();
  });

  it("focuses one cluster without redrawing the layout", async () => {
    const user = userEvent.setup();
    render();

    const clusters = await screen.findByTestId("community-list");
    await user.click(within(clusters).getByText("Stonebridge Group"));

    // Everything outside the chosen cluster is dimmed rather than removed:
    // a picture that deletes the context stops being a picture of the whole.
    await waitFor(() => {
      const dimmed = document.querySelectorAll("g.nu-force-node.nu-dimmed");
      expect(dimmed.length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("button", { name: /Show every cluster/ })).toBeInTheDocument();
  });

  it("asks the server for a different focus rather than re-clustering here", async () => {
    const user = userEvent.setup();
    const onFocus = vi.fn();
    render({ onFocus });

    await screen.findByTestId("force-graph");
    await user.click(screen.getByText("Projects"));

    expect(onFocus).toHaveBeenCalledWith("project");
  });

  it("says which permission is missing rather than drawing nothing", async () => {
    server.use(
      http.get("/platform/api/relationships/network", () =>
        HttpResponse.json(
          {
            error: "forbidden",
            message: "refused",
            details: { missing: ["records.view"], missing_labels: ["View records"] },
          },
          { status: 403 },
        ),
      ),
    );

    render();

    await waitFor(() =>
      expect(
        screen.getByText("You do not have permission to read the record graph"),
      ).toBeInTheDocument(),
    );
  });

  it("says a graph with nothing in it is empty rather than rendering a blank box", async () => {
    server.use(
      http.get("/platform/api/relationships/network", ({ request }) =>
        HttpResponse.json({
          focus: { key: "customer", label: "Customers" },
          available: [{ key: "customer", label: "Customers" }],
          nodes: [],
          edges: [],
          communities: [],
          stats: { nodes: 0, edges: 0, communities: 0, modularity: 0, bridges: 0 },
        }, { headers: { "X-Correlation-ID": request.headers.get("X-Correlation-ID") ?? "" } }),
      ),
    );

    render();

    expect(
      await screen.findByText("There is nothing linked to cluster yet."),
    ).toBeInTheDocument();
  });
});
