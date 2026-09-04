import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import { ConnectionMapView } from "@/components/relationships/ConnectionMapView";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

describe("the connection map", () => {
  it("answers before a record is chosen, rather than showing an empty search box", async () => {
    renderWithProviders(<ConnectionMapView onStart={vi.fn()} />);

    // The three things only visible in aggregate.
    expect(await screen.findByTestId("schema-graph")).toBeInTheDocument();
    expect(screen.getByTestId("relation-strength")).toBeInTheDocument();
    expect(screen.getByTestId("hub-records")).toBeInTheDocument();
  });

  it("counts what is actually there, from the server", async () => {
    renderWithProviders(<ConnectionMapView onStart={vi.fn()} />);

    await screen.findByTestId("schema-graph");
    expect(screen.getByText("Entities")).toBeInTheDocument();
    expect(screen.getByText("1,850")).toBeInTheDocument();
    expect(screen.getByText("1,090")).toBeInTheDocument();
  });

  it("draws every entity and relation the server sent", async () => {
    renderWithProviders(<ConnectionMapView onStart={vi.fn()} />);

    const graph = await screen.findByRole("img", {
      name: "4 entities connected by 2 relations",
    });
    // Nodes are labelled for a screen reader, not only drawn.
    expect(within(graph).getByLabelText("Tickets, 600 records")).toBeInTheDocument();
    expect(within(graph).getByLabelText("Customers, 300 records")).toBeInTheDocument();
  });

  it("reports coverage, because the rows missing a link are the finding", async () => {
    renderWithProviders(<ConnectionMapView onStart={vi.fn()} />);

    const strength = await screen.findByTestId("relation-strength");
    // 51.7% of tickets name a customer — the other half is what somebody came
    // here to find.
    expect(within(strength).getByText("51.7%")).toBeInTheDocument();
    expect(within(strength).getByText("97.5%")).toBeInTheDocument();
  });

  it("offers the most connected records as a place to start", async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    renderWithProviders(<ConnectionMapView onStart={onStart} />);

    const hubs = await screen.findByTestId("hub-records");
    expect(within(hubs).getByText("Northwind Partners")).toBeInTheDocument();
    expect(within(hubs).getByText("42 links")).toBeInTheDocument();

    await user.click(within(hubs).getByRole("button", { name: /Explore/ }));
    expect(onStart).toHaveBeenCalledWith("customer", "customer-1");
  });

  it("says which permission is missing rather than drawing nothing", async () => {
    server.use(
      http.get("/platform/api/relationships/overview", () =>
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

    renderWithProviders(<ConnectionMapView onStart={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByText("You do not have permission to read the connection map"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/View records/)).toBeInTheDocument();
  });
});
