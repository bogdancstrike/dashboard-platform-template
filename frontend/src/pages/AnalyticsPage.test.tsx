import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import AnalyticsPage from "@/pages/AnalyticsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { analysisResult } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The analytics workspace (§2, §44, §72).
 *
 * What is worth asserting is the *shared context*: that one period reaches
 * every panel, that the panels ask the server rather than reshaping a page of
 * rows, that the context round-trips through the URL, and that a chart is a
 * way into the records rather than a picture of them.
 */
/**
 * The router's own idea of the address.
 *
 * `MemoryRouter` keeps the location internally, so `window.location` never
 * moves; reading it from the router is what actually asserts §72 rather than
 * asserting that a control looks selected.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/analytics") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/orders" element={<div>the orders ledger</div>} />
        <Route path="/explore" element={<div>the explorer</div>} />
        <Route path="/reports/builder" element={<div>the report builder</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

/** Every analysis the page asked for. */
function captureRequests(): Record<string, unknown>[] {
  const asked: Record<string, unknown>[] = [];
  server.use(
    http.post("/platform/api/analysis/run", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      asked.push(body);
      return HttpResponse.json(analysisResult(body));
    }),
  );
  return asked;
}

describe("the analytics workspace", () => {
  it("asks the server for every panel, over one shared period", async () => {
    const asked = captureRequests();
    render("/analytics?period=last_30_days");

    await screen.findByTestId("analysis-headline");
    // The headline, the trend and the breakdown are three GROUP BYs of one
    // query — so they cannot disagree about which rows they measured.
    await waitFor(() => expect(asked.length).toBeGreaterThanOrEqual(3));
    expect(asked.every((request) => request["period"] === "last_30_days")).toBe(true);
    expect(asked.some((request) => Array.isArray(request["dimensions"]) && request["dimensions"].length === 0)).toBe(false);
  });

  it("changes every panel when the period changes, and records it in the URL", async () => {
    const user = userEvent.setup();
    const asked = captureRequests();
    render();

    await screen.findByTestId("analysis-headline");
    await user.click(screen.getByRole("combobox", { name: "Period" }));
    await user.click(await screen.findByTitle("Last 365 days"));

    await waitFor(() =>
      expect(asked.filter((request) => request["period"] === "last_365_days").length).toBeGreaterThan(1),
    );
    // §72: pasted to somebody else, the link is the same finding.
    expect(screen.getByTestId("address")).toHaveTextContent("period=last_365_days");
  });

  it("groups by the column the reader picked, not one the page chose", async () => {
    const user = userEvent.setup();
    const asked = captureRequests();
    render();

    await screen.findByTestId("analysis-headline");
    await user.click(screen.getByRole("combobox", { name: "Group by" }));
    await user.click(await screen.findByTitle("Channel"));

    await waitFor(() =>
      expect(
        asked.some((request) => JSON.stringify(request["dimensions"] ?? []).includes("channel")),
      ).toBe(true),
    );
  });

  it("drills from a chart into the records behind it (§44)", async () => {
    const user = userEvent.setup();
    render();

    // The table view of a panel is the accessible path to the same values, and
    // clicking one is the same drill-down a bar click performs.
    const breakdown = await screen.findByTestId("analytics-breakdown");
    await user.click(within(breakdown).getByTitle("Table"));
    await user.click(await within(breakdown).findByText("CONFIRMED"));

    expect(await screen.findByText("the orders ledger")).toBeInTheDocument();
    expect(screen.getByTestId("address")).toHaveTextContent("f.status=CONFIRMED");
  });

  it("says which permission is missing rather than drawing empty panels", async () => {
    server.use(
      http.get("/platform/api/analysis/catalog", () =>
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

    expect(await screen.findByText("refused")).toBeInTheDocument();
  });
});
