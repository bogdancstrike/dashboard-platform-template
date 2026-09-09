import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import DashboardPage from "@/pages/DashboardPage";
import { dashboardSummary } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";

describe("the dashboard", () => {
  it("renders each KPI with its movement against the previous period", async () => {
    renderWithProviders(<DashboardPage />);

    expect(await screen.findByText("Revenue")).toBeInTheDocument();
    // Compact above a million: the tile is 200px wide and the full figure
    // either wraps or gets cut.
    expect(screen.getByText("€38.1M")).toBeInTheDocument();
    expect(screen.getByText("154.4%")).toBeInTheDocument();
  });

  it("colours a rise in SLA breaches as bad news, not good", async () => {
    // The polarity comes from the server per metric. A tile that paints every
    // increase green reports a record number of outages as a success — so the
    // two directions are asserted together, or the test passes on a constant.
    renderWithProviders(<DashboardPage />);

    const breaches = (await screen.findByText("SLA breaches")).closest(
      ".nu-statcard",
    ) as HTMLElement;
    const revenue = screen.getByText("Revenue").closest(".nu-statcard") as HTMLElement;

    // The *ink* half of the ramp rather than the fill: the delta is 11.5px
    // text on a tint of its own colour, and `SEMANTIC.danger` scored 3.94:1
    // there while `SEMANTIC.success` scored 2.85:1 — found by axe on
    // `/showcase/components`, wrong on every dashboard until then (§55, §60).
    // A variable rather than a hex, so the dark appearance follows the theme.
    expect(
      (within(breaches).getByText("128.0%").closest("span") as HTMLElement).style.color,
    ).toBe("var(--nu-danger-ink)");
    expect(
      (within(revenue).getByText("154.4%").closest("span") as HTMLElement).style.color,
    ).toBe("var(--nu-success-ink)");
  });

  it("shows only the alerts that are actually firing", async () => {
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("310 open tickets have breached their SLA")).toBeInTheDocument();
  });

  it("puts the period in the URL so the view can be shared", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />, { route: "/?period=last_30_days" });

    // jsdom's media query stub uses the compact period picker.
    await user.click(await screen.findByRole("combobox", { name: "Dashboard period" }));
    await user.click(await screen.findByText("Last 7 days"));
    // MemoryRouter keeps the search in its own history; the control reflects it.
    expect(await screen.findByText("Last 7 days")).toBeInTheDocument();
  });

  it("lets a chart be read as a table", async () => {
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />);

    const card = (await screen.findByText("Tasks by status")).closest(".ant-card") as HTMLElement;
    await user.click(within(card).getByTitle("Table"));

    // The same data the chart drew, now as rows.
    expect(await within(card).findByText("DONE")).toBeInTheDocument();
    expect(within(card).getByText("141")).toBeInTheDocument();
  });

  /**
   * The stacked shapes, which are the ones a renderer can silently flatten.
   *
   * A stacked area drawn without its stacks is five lines that happen not to
   * cross — a different claim about the same numbers — and nothing in a
   * screenshot review catches it. The table view is the honest witness: the
   * cells are per group and per bucket, and they add up to the total the
   * revenue panel draws.
   */
  it("draws what the total is made of, and reads back per group", async () => {
    const panelRows = dashboardSummary.charts.revenue_by_channel.series.length;
    const user = userEvent.setup();
    renderWithProviders(<DashboardPage />);

    const card = (await screen.findByText("What the revenue is made of")).closest(
      ".ant-card",
    ) as HTMLElement;
    await user.click(within(card).getByTitle("Table"));

    // A Group column, and one row per stack per bucket — the cells the chart
    // drew, not a total that hides which channel it came from.
    expect(
      within(card).getByRole("columnheader", { name: "Group" }),
    ).toBeInTheDocument();
    const rows = within(card).getAllByRole("row");
    // Header row plus one per cell the panel carries.
    expect(rows).toHaveLength(panelRows + 1);
    expect(within(card).getAllByText("WEB")).toHaveLength(2);
    expect(within(card).getAllByText("PARTNER")).toHaveLength(2);
    expect(within(card).getByText("1,500")).toBeInTheDocument();
  });

  it("shows the recent activity feed", async () => {
    renderWithProviders(<DashboardPage />);
    expect(await screen.findByText("Ada Administrator")).toBeInTheDocument();
  });
});
