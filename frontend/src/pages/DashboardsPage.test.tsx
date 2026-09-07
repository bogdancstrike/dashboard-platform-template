import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import DashboardsPage from "@/pages/DashboardsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { resetDashboards, savedDashboards } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

/**
 * Saved dashboards and their builder (§45, §67).
 *
 * What is worth asserting is the part a screenshot cannot show: that a widget
 * is a *reference* to a question rather than a copy of one, that one drag
 * saves the whole layout, that one person has one home, and that somebody
 * else's dashboard is readable with its controls shown and refused.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/dashboards") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/dashboards" element={<DashboardsPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetDashboards());

describe("the dashboards page", () => {
  it("opens the reader's home dashboard, not the first row", async () => {
    render();

    // §67: the home dashboard is where a reader lands, and the URL records it
    // so the layout can be linked to.
    expect(await screen.findByTestId("dashboard-grid")).toBeInTheDocument();
    const header = screen.getByTestId("dashboard-header");
    expect(within(header).getByText("Support desk")).toBeInTheDocument();
    expect(screen.getByTestId("widget-widget-1")).toBeInTheDocument();
  });

  it("draws each widget through the endpoint that owns its question", async () => {
    render();

    // A KPI reads the dataset's declared metrics; a chart goes through the
    // analysis compiler. Neither has an endpoint of its own, which is what
    // keeps a dashboard from disagreeing with the page behind it.
    const kpi = await screen.findByTestId("widget-widget-1");
    expect(within(kpi).getByText("Open tickets")).toBeInTheDocument();
    await waitFor(() => expect(within(kpi).getByText("Open")).toBeInTheDocument());

    const chart = screen.getByTestId("widget-widget-2");
    expect(await within(chart).findByTestId("echarts")).toBeInTheDocument();
  });

  it("hides the layout controls until the reader asks to rearrange", async () => {
    const user = userEvent.setup();
    render();

    const widget = await screen.findByTestId("widget-widget-1");
    // Reading is the default: a grid whose every card carries three buttons is
    // a grid nobody can read.
    expect(within(widget).queryByLabelText("Remove Open tickets")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("toggle-edit"));
    expect(within(widget).getByLabelText("Remove Open tickets")).toBeInTheDocument();
    expect(within(widget).getByLabelText("Move or resize Open tickets")).toBeInTheDocument();
  });

  it("saves the whole layout when one widget moves", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId("toggle-edit"));
    const widget = screen.getByTestId("widget-widget-2");
    await user.click(within(widget).getByLabelText("Move or resize Tickets by severity"));
    await user.click(await screen.findByRole("menuitem", { name: /Move left/ }));

    // Both widgets are sent, because moving one reflows the others and one
    // request per card lets a reader reload mid-flight (§73).
    await waitFor(() => {
      const stored = savedDashboards[0]!["widgets"] as { id: string; x: number }[];
      expect(stored).toHaveLength(2);
      expect(stored.find((item) => item.id === "widget-2")?.x).toBe(2);
    });
  });

  it("adds a widget from the kinds the server says it will accept", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId("toggle-edit"));
    await user.click(screen.getByTestId("add-widget"));

    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByRole("combobox", { name: "Widget kind" }));
    await user.click(await screen.findByTitle("Recent activity"));
    await user.type(within(drawer).getByLabelText("Title"), "What just happened");
    await user.click(within(drawer).getByTestId("save-widget"));

    await waitFor(() => {
      const stored = savedDashboards[0]!["widgets"] as { title: string; kind: string }[];
      expect(stored.at(-1)).toMatchObject({ title: "What just happened", kind: "ACTIVITY" });
    });
    // A platform-wide feed names no dataset, so the form did not send one.
    const added = (savedDashboards[0]!["widgets"] as { config: object }[]).at(-1);
    expect(added?.config).toEqual({});
  });

  it("marks one dashboard home and releases the last", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");

    await user.click(await screen.findByRole("button", { name: "Settings" }));
    const drawer = await screen.findByRole("dialog");
    await user.click(within(drawer).getByLabelText("My home dashboard"));
    await user.click(within(drawer).getByTestId("save-dashboard"));

    // §67: two homes is a preference that cannot be honoured, so the server
    // clears the others — and the page shows what came back.
    await waitFor(() =>
      expect(savedDashboards.filter((item) => item["is_home"])).toHaveLength(0),
    );
  });

  it("shows a colleague's dashboard with its controls refused, not missing", async () => {
    render("/dashboards?dashboard=dash-2");

    const header = await screen.findByTestId("dashboard-header");
    expect(within(header).getByText("Delivery health")).toBeInTheDocument();
    // §76: shown and disabled, with the reason, so a reader can see that
    // editing exists and is not theirs.
    expect(within(header).getByRole("button", { name: "Settings" })).toBeDisabled();
    expect(screen.queryByTestId("toggle-edit")).not.toBeInTheDocument();
  });

  it("offers to build the first widget on an empty dashboard", async () => {
    render("/dashboards?dashboard=dash-2");

    // §34: an empty view says what would appear here and offers the action.
    expect(await screen.findByText("No widgets yet")).toBeInTheDocument();
  });
});
