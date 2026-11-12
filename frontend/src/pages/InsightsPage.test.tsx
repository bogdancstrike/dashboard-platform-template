import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import InsightsPage from "@/pages/InsightsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { chartOption } from "@/components/insights/InsightView";
import { InsightWidgetBody } from "@/components/insights/InsightWidgetBody";
import { formatValue, parseBlocks, parseNode, type ChartNode } from "@/components/insights/spec";
import { BOUND_BLOCKS, insightsFlags, insightsState, resetInsights } from "@/test/handlers/insights";
import { renderWithProviders } from "@/test/render";
import { buildChartTheme } from "@/theme/echarts";

/**
 * Insights (§43): ask, see a page drawn from the registry, keep it, and look
 * after it — with anything outside the registry skipped rather than drawn.
 */
function render(route = "/ai/insights") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/ai/insights" element={<InsightsPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

beforeEach(() => resetInsights());

describe("InsightsPage", () => {
  it("opens on the gallery, pinned first, with suggestions to press", async () => {
    render();
    const cards = await screen.findAllByTestId("insight-card");
    expect(cards[0]).toHaveTextContent("Sales this year");
    expect(within(screen.getByTestId("insight-suggestions")).getByText("How are sales trending this year?")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Mine"));
    expect(screen.getAllByTestId("insight-card")).toHaveLength(1);
  });

  it("builds a page for a question, skips what the registry does not know, and saves it", async () => {
    render();
    await userEvent.type(await screen.findByTestId("insight-question"), "Where do orders come from?");
    await userEvent.click(screen.getByTestId("insight-generate"));
    const panel = await screen.findByTestId("insight-panel");
    expect(within(panel).getByTestId("insight-title")).toHaveTextContent("Sales this year");
    expect(within(panel).getAllByTestId("insight-node")).toHaveLength(4);
    expect(within(panel).getByTestId("insight-kpi-delta")).toHaveTextContent("25%");
    expect(within(panel).getByText("ORD-1").closest("a")).toHaveAttribute("href", "/orders/o1");
    expect(within(panel).getByTestId("insight-warnings")).toHaveTextContent("hologram");
    await userEvent.click(within(panel).getByTestId("insight-save"));
    await waitFor(() => expect(insightsState.items).toHaveLength(3));
    expect(await screen.findByTestId("insight-refresh")).toBeInTheDocument();
  });

  it("opens a suggestion without the model", async () => {
    render();
    await userEvent.click(await screen.findByText("How is support keeping up?"));
    const panel = await screen.findByTestId("insight-panel");
    expect(panel).toHaveTextContent("Suggested");
    expect(screen.getByTestId("insight-question")).toHaveValue("Suggested ticket-1");
  });

  it("says plainly when the model is unavailable", async () => {
    insightsFlags.generateStatus = 503;
    render();
    await userEvent.type(await screen.findByTestId("insight-question"), "Anything?");
    await userEvent.click(screen.getByTestId("insight-generate"));
    expect(await screen.findByTestId("insight-failure")).toHaveTextContent("not available right now");
    insightsFlags.generateStatus = 200;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("insight-panel")).toBeInTheDocument();
  });

  it("refreshes, pins, shares, renames and removes a saved insight", async () => {
    render("/ai/insights?insight=in-1");
    await screen.findByTestId("insight-panel");
    await userEvent.click(screen.getByTestId("insight-refresh"));
    await waitFor(() => expect(insightsState.items[0]!.refreshed_at).toBe("2026-09-04T11:00:00Z"));
    await userEvent.click(screen.getByTestId("insight-pin"));
    await waitFor(() => expect(insightsState.items[0]!.pinned).toBe(false));

    await userEvent.click(screen.getByTestId("insight-more"));
    await userEvent.click(await screen.findByText("Make private"));
    await waitFor(() => expect(insightsState.items[0]!.scope).toBe("PRIVATE"));

    await userEvent.click(screen.getByTestId("insight-more"));
    await userEvent.click(await screen.findByText("Rename"));
    const dialog = await screen.findByRole("dialog");
    const field = within(dialog).getByRole("textbox");
    await userEvent.clear(field);
    await userEvent.type(field, "Revenue");
    await userEvent.click(within(dialog).getByRole("button", { name: "Rename" }));
    await waitFor(() => expect(insightsState.items[0]!.title).toBe("Revenue"));

    await userEvent.click(screen.getByRole("button", { name: "Remove insight" }));
    await userEvent.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(insightsState.items.find((i) => i.id === "in-1")).toBeUndefined());
  });

  it("offers adding a saved insight to a dashboard", async () => {
    render("/ai/insights?insight=in-1");
    await userEvent.click(await screen.findByTestId("insight-dashboard"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("shows another person's insight without the owner's controls", async () => {
    render("/ai/insights?insight=in-2");
    await screen.findByTestId("insight-panel");
    expect(screen.queryByTestId("insight-pin")).not.toBeInTheDocument();
    expect(screen.getByTestId("insight-refresh")).toBeInTheDocument();
  });

  it("says when an insight is not available", async () => {
    render("/ai/insights?insight=in-404");
    expect(await screen.findByText("That insight is not available")).toBeInTheDocument();
  });

  it("opens a card from the gallery", async () => {
    render();
    fireEvent.click((await screen.findAllByTestId("insight-card"))[1]!);
    expect(await screen.findByTestId("insight-title")).toHaveTextContent("Support at a glance");
  });
});

describe("the registry on the client", () => {
  it("parses every component and drops what it does not know", () => {
    const nodes = parseBlocks([
      ...BOUND_BLOCKS,
      null,
      { type: "markdown", text: "" },
      { type: "callout", tone: "loud", text: "Note" },
      { type: "progress", label: "Done", max: 10, data: { value: 4 } },
      { type: "comparison", data: { items: [{ label: "A", value: 2 }, { label: "B", value: "x" }] } },
      { type: "timeline", data: { events: [{ date: "2026-01-01", title: "Start", tone: "success", href: "//evil" }] } },
      { type: "list", data: { items: [{ title: "One", status: "OPEN", href: "/x" }] } },
      { type: "section", title: "S", blocks: [{ type: "section", blocks: [] }, { type: "kpi", label: "Inner", value: 3 }] },
      { type: "pie", data: { categories: [], series: [] } },
      { type: "line", error: "No permission" },
    ]);
    const types = nodes.map((n) => n.type);
    expect(types).not.toContain("hologram");
    expect(types).not.toContain("markdown");
    expect(nodes.find((n) => n.type === "callout")).toMatchObject({ tone: "info" });
    const timeline = nodes.find((n) => n.type === "timeline");
    expect(timeline && "events" in timeline && timeline.events[0]!.href).toBeUndefined();
    const section = nodes.find((n) => n.type === "section");
    expect(section && "blocks" in section && section.blocks.map((b) => b.type)).toEqual(["kpi"]);
    expect(parseNode({ type: "section", blocks: [] }, 2)).toBeNull();
  });

  it("formats numbers for tiles", () => {
    expect(formatValue(null, "number")).toBe("—");
    expect(formatValue("n/a", "number")).toBe("n/a");
    expect(formatValue(12.5, "percent")).toBe("12.5%");
    expect(formatValue(3, "duration")).toBe("3 h");
    expect(formatValue(1500000, "currency", true)).toBe("1.5M");
  });

  it("builds chart options for every chart kind", () => {
    const theme = buildChartTheme("light", "middle");
    const base: ChartNode = { type: "bar", width: "half", format: "number", categories: ["A", "B"],
                              series: [{ name: "x", values: [1, 2] }, { name: "y", values: [3, 4] }, { name: "z", values: [5, 6] }] };
    const bar = chartOption({ ...base, horizontal: true }, theme) as { series: { stack?: string }[]; yAxis: { type: string } };
    expect(bar.yAxis.type).toBe("category");
    expect(bar.series[0]!.stack).toBe("total");
    const pie = chartOption({ ...base, type: "pie" }, theme) as { series: { data: unknown[] }[] };
    expect(pie.series[0]!.data).toHaveLength(2);
    const area = chartOption({ ...base, type: "area", series: [base.series[0]!] }, theme) as { series: { areaStyle?: unknown }[] };
    expect(area.series[0]!.areaStyle).toBeTruthy();
  });
});

describe("InsightWidgetBody", () => {
  it("draws a saved insight on a dashboard with fresh numbers", async () => {
    renderWithProviders(<InsightWidgetBody id="in-1" />);
    expect(await screen.findByTestId("insight-widget")).toBeInTheDocument();
    expect(screen.getByText("Open the insight")).toHaveAttribute("href", "/ai/insights?insight=in-1");
  });

  it("says when the insight is gone", async () => {
    renderWithProviders(<InsightWidgetBody id="in-404" />);
    expect(await screen.findByText("That insight is not available to you")).toBeInTheDocument();
  });
});

describe("InsightView", () => {
  it("draws every component in the registry", async () => {
    const { InsightView } = await import("@/components/insights/InsightView");
    renderWithProviders(
      <InsightView
        blocks={[
          { type: "markdown", text: "**Phone** leads." },
          { type: "callout", tone: "warning", title: "Mixed currencies", text: "Totals are not converted." },
          { type: "progress", label: "Delivered", max: 10, hint: "of target", data: { value: 4 } },
          { type: "progress", label: "Unbounded", data: { value: 4 } },
          { type: "comparison", title: "Channels", data: { items: [{ label: "DIRECT_SALES", value: 3 }, { label: "B", value: null }] } },
          { type: "timeline", title: "Recent", data: { events: [{ date: "2026-01-01", title: "Shipped", text: "IN_TRANSIT", tone: "success", href: "/orders/1" }, { date: "2026-01-02", title: "Plain" }] } },
          { type: "timeline", title: "Empty", data: { events: [] } },
          { type: "list", title: "Records", data: { items: [{ title: "One", subtitle: "OPEN_NOW", status: "OPEN", value: 5, href: "/x/1" }, { title: "Two" }] } },
          { type: "list", title: "None", data: { items: [] } },
          { type: "table", title: "Empty table", data: { columns: [], rows: [] } },
          { type: "table", title: "Mixed", data: { columns: [{ key: "a", label: "A" }, { key: "b", label: "B", numeric: true }, { key: "c", label: "C" }, { key: "d", label: "D" }], rows: [{ a: "2026-01-01T10:00:00Z", b: "7", c: true, d: null }] } },
          { type: "section", title: "More", blocks: [{ type: "kpi", label: "Inner", value: 3 }] },
          { type: "line", title: "Broken", error: "You may not read tickets." },
          { type: "pie", title: "Nothing", data: { categories: [], series: [] } },
        ]}
      />,
    );
    expect(screen.getByText("Phone").tagName).toBe("STRONG");
    expect(screen.getByRole("note")).toHaveTextContent("Mixed currencies");
    expect(screen.getByText(/4 of 10 · of target/)).toBeInTheDocument();
    expect(screen.getByText("DIRECT SALES")).toBeInTheDocument();
    expect(screen.getByText("Shipped").closest("a")).toHaveAttribute("href", "/orders/1");
    expect(screen.getByText("Nothing happened in this window.")).toBeInTheDocument();
    expect(screen.getByText("One").closest("a")).toHaveAttribute("href", "/x/1");
    expect(screen.getByText("Nothing to list.")).toBeInTheDocument();
    expect(screen.getAllByText("No records match.")).toHaveLength(2);
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("More")).toBeInTheDocument();
    expect(screen.getByTestId("insight-node-error")).toHaveTextContent("You may not read tickets.");
  });

  it("says when there is nothing it can draw", async () => {
    const { InsightView } = await import("@/components/insights/InsightView");
    renderWithProviders(<InsightView blocks={[{ type: "hologram" }]} />);
    expect(screen.getByText("Nothing to show")).toBeInTheDocument();
  });
});
