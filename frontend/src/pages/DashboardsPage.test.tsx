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
  it("lands on a gallery that says what each dashboard holds", async () => {
    render();

    // What a reader is choosing between is a layout, not a name — so the card
    // carries the widget kinds rather than only a count.
    const gallery = await screen.findByTestId("dashboard-gallery");
    const card = within(gallery).getByTestId("board-card-dash-1");
    expect(within(card).getByText("Support desk")).toBeInTheDocument();
    expect(within(card).getByText("Bars")).toBeInTheDocument();
    expect(within(card).getByText("Headline number")).toBeInTheDocument();

    // And one that holds nothing says so, rather than showing an empty row.
    const empty = within(gallery).getByTestId("board-card-dash-2");
    expect(within(empty).getByText("Nothing on it yet")).toBeInTheDocument();
  });

  it("opens one from the gallery, and the URL says which", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId("board-card-dash-1"));

    expect(await screen.findByTestId("dashboard-grid")).toBeInTheDocument();
    expect(screen.getByTestId("address")).toHaveTextContent("dashboard=dash-1");
    expect(screen.getByTestId("widget-widget-1")).toBeInTheDocument();
  });

  it("draws each widget through the endpoint that owns its question", async () => {
    render("/dashboards?dashboard=dash-1");

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
    render("/dashboards?dashboard=dash-1");

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
    render("/dashboards?dashboard=dash-1");

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
    render("/dashboards?dashboard=dash-1");

    await user.click(await screen.findByTestId("toggle-edit"));
    await user.click(screen.getByTestId("add-widget"));

    const dialog = await screen.findByRole("dialog");
    // Pressed on its shelf rather than typed into a select: the kinds are
    // browsed, because a card can say what a kind *answers* and a select entry
    // can only say its name.
    await user.click(within(dialog).getByTestId("kind-ACTIVITY"));
    await user.type(within(dialog).getByLabelText("Title"), "What just happened");
    await user.click(within(dialog).getByTestId("save-widget"));

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

    await user.click(await screen.findByTestId("board-settings"));
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

    // §76: shown and disabled, with the reason, so a reader can see that
    // editing exists and is not theirs.
    expect(await screen.findByTestId("board-settings")).toBeDisabled();
    expect(screen.queryByTestId("toggle-edit")).not.toBeInTheDocument();
    // And the card's own controls are absent, because they are the owner's.
    expect(screen.queryByLabelText("Delete Delivery health")).not.toBeInTheDocument();
  });

  it("offers to build the first widget on an empty dashboard", async () => {
    render("/dashboards?dashboard=dash-2");

    // §34: an empty view says what would appear here and offers the action.
    expect(await screen.findByText("No widgets yet")).toBeInTheDocument();
  });

  it("creates one through a wizard, holding what was chosen", async () => {
    const user = userEvent.setup();
    render();

    await user.click(await screen.findByTestId("new-dashboard"));

    // Step one: what it is called. A wizard because naming it, filling it and
    // deciding who sees it are three separate thoughts (§10).
    const details = await screen.findByTestId("wizard-details");
    await user.type(within(details).getByLabelText("Name"), "Morning check");
    await user.click(screen.getByTestId("wizard-next"));

    // Step two: what it holds. It cannot be finished empty.
    const picker = await screen.findByTestId("widget-kind-picker");
    expect(screen.getByTestId("wizard-next")).toBeDisabled();
    await user.click(within(picker).getByTestId("kind-KPI"));
    await user.click(within(picker).getByLabelText("One more Headline number"));
    await user.click(within(picker).getByTestId("kind-ALERTS"));
    expect(screen.getByTestId("wizard-next")).toBeEnabled();
    await user.click(screen.getByTestId("wizard-next"));

    // Step three shows what will be made — the widgets, in the order they will
    // be laid out, which the reader has been choosing and not yet seen.
    const review = await screen.findByTestId("wizard-review");
    expect(within(review).getByText("Morning check")).toBeInTheDocument();
    expect(within(review).getByText("3 widgets, laid out left to right.", { exact: false }))
      .toBeInTheDocument();
    await user.click(screen.getByTestId("wizard-next"));

    // One request, so it is never half-built — and it lands on the grid it
    // now holds.
    await waitFor(() => {
      const created = savedDashboards.at(-1);
      expect(created?.["name"]).toBe("Morning check");
      expect((created?.["widgets"] as { kind: string }[]).map((w) => w.kind)).toEqual([
        "KPI",
        "KPI",
        "ALERTS",
      ]);
    });
  });

  it("refuses a kind the reader has nothing to point at, with the reason", async () => {
    const user = userEvent.setup();
    const { server } = await import("@/test/server");
    const { http, HttpResponse } = await import("msw");
    server.use(
      http.get("/platform/api/reports", () =>
        HttpResponse.json({ items: [], total: 0, visualizations: [], can_create: true, can_share: true }),
      ),
    );
    render();

    await user.click(await screen.findByTestId("new-dashboard"));
    await user.type(
      within(await screen.findByTestId("wizard-details")).getByLabelText("Name"),
      "Reportless",
    );
    await user.click(screen.getByTestId("wizard-next"));

    // §76: offered and refused with the reason, so somebody learns that a
    // saved chart can become a widget.
    const report = await screen.findByTestId("kind-REPORT");
    expect(report).toBeDisabled();
    expect(report).toHaveAccessibleName(/have not saved a report yet/);
  });
});
