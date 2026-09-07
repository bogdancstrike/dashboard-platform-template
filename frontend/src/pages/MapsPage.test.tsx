import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import MapsPage from "@/pages/MapsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { renderWithProviders } from "@/test/render";

/**
 * Records on a map (§44, §61).
 *
 * Two claims worth asserting here rather than end to end: that what cannot be
 * placed is *on the screen* rather than in the gap between the map and the
 * list, and that every blob is also a row — a coloured shape is not a finding,
 * and not everybody sees colour (§55).
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/maps") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/maps" element={<MapsPage />} />
        <Route path="/customers" element={<div>the accounts</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

describe("the map page", () => {
  it("says how many records it could not place, rather than quietly drawing fewer", async () => {
    render();

    const coverage = await screen.findByTestId("map-coverage");
    expect(coverage).toHaveTextContent("27 customers");
    expect(coverage).toHaveTextContent("3 we cannot place");
    // And again in full, because a tag is a hint and this is the caveat that
    // decides whether the picture can be trusted.
    expect(
      screen.getByText(/3 of 27 could not be placed/),
    ).toBeInTheDocument();
  });

  it("draws every blob as a row as well, at both levels", async () => {
    render();

    const regions = await screen.findByTestId("map-regions");
    expect(await within(regions).findByText("Western Europe")).toBeInTheDocument();
    // Named, not coded: "NEU" in a table is a table written for whoever
    // built the seed.
    expect(within(regions).getByText("North America")).toBeInTheDocument();

    const countries = await screen.findByTestId("map-countries");
    expect(await within(countries).findByText("Germany")).toBeInTheDocument();
    // The world map's own name for the country, which is not always the
    // records' name — the mismatch is the one failure a choropleth cannot
    // survive, so it is visible here too.
    expect(within(countries).getByText("United States of America")).toBeInTheDocument();
  });

  it("keeps the dataset, the measure and the period in the URL", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByRole("combobox", { name: "Dataset" }));
    await user.click(await screen.findByTitle("Orders"));

    await waitFor(() => expect(screen.getByTestId("address")).toHaveTextContent("dataset=order"));
    // The measure resets with the dataset: "Lifetime value" is not a thing an
    // order has, and carrying it over would ask the server for a column the
    // dataset does not declare.
    expect(screen.getByTestId("address")).not.toHaveTextContent("metric=value");
  });

  it("says where a click will lead when the dataset borrows its place", async () => {
    render("/maps?dataset=order");

    // An order carries no country of its own — it is drawn at its customer's
    // city — so the drill-down opens the customers, and says so rather than
    // pretending the order list can be filtered by a column it lacks.
    const countries = await screen.findByTestId("map-countries");
    expect(
      within(countries).getByText(/Opens the customers there/),
    ).toBeInTheDocument();
  });

  it("drills from a country into the list of records there", async () => {
    const user = userEvent.setup();
    render();

    const countries = await screen.findByTestId("map-countries");
    await user.click(await within(countries).findByText("Germany"));

    // Filtered by what the *records* call the country, not by what the map
    // does — the two differ, and the list only knows the former.
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("/customers?f.country=Germany"),
    );
  });
});
