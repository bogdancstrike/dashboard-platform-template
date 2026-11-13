import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { DashboardWidget, WidgetInput, WidgetKind } from "@/api/dashboards";
import { KINDS } from "@/components/dashboards/kinds";
import { WidgetModal } from "@/components/dashboards/WidgetModal";
import { explorerCatalogue } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The add-a-widget modal, on its own (§45).
 *
 * The dashboard page's tests add a KPI and a chart; this walks every kind the
 * catalogue offers, because each one asks a different question and saves a
 * different config — and a kind whose form saves the wrong shape is a widget
 * that draws "no data" forever without anybody being told why.
 */
const DATASETS = [
  { key: "ticket", label: "Tickets" },
  { key: "order", label: "Orders" },
];
const ALL_KINDS = Object.keys(KINDS) as WidgetKind[];

function open(props: Partial<Parameters<typeof WidgetModal>[0]> = {}) {
  const onSave = vi.fn<(input: WidgetInput) => void>();
  const onClose = vi.fn();
  renderWithProviders(
    <WidgetModal
      open
      widget={null}
      datasets={DATASETS}
      kinds={ALL_KINDS}
      saving={false}
      period="30d"
      resources={explorerCatalogue.items}
      onClose={onClose}
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave, onClose };
}

function widget(kind: WidgetKind, config: DashboardWidget["config"] = {}): DashboardWidget {
  return {
    id: `w-${kind}`,
    kind,
    title: `My ${kind.toLowerCase()}`,
    subtitle: "A note",
    x: 0,
    y: 0,
    width: 6,
    height: 2,
    position: 0,
    config,
  };
}

/** Opens a Select by its label and takes its first option. */
async function chooseFirst(label: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const option = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
    );
    if (!found) throw new Error(`no options for ${label}`);
    return found;
  });
  await user.click(option);
}

describe("choosing what a widget shows", () => {
  it("starts on the tiles, grouped by family, with only a way out", () => {
    open();
    const tiles = screen.getByTestId("widget-kind-tiles");
    expect(within(tiles).getAllByRole("button").length).toBe(ALL_KINDS.length);
    expect(screen.getByText("Step 1 of 2 · what it shows")).toBeInTheDocument();
    expect(screen.queryByTestId("save-widget")).not.toBeInTheDocument();
  });

  it("offers only the kinds the dashboard allows", () => {
    open({ kinds: ["KPI", "MAIL"] });
    expect(screen.getByTestId("widget-tile-KPI")).toBeInTheDocument();
    expect(screen.getByTestId("widget-tile-MAIL")).toBeInTheDocument();
    expect(screen.queryByTestId("widget-tile-TASKS")).not.toBeInTheDocument();
  });

  it("goes back from the form to the tiles", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByTestId("widget-tile-KPI"));
    expect(screen.getByText(/Step 2 of 2/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByTestId("widget-kind-tiles")).toBeInTheDocument();
  });

  it("hands the choice to the page when the page keeps the steps in its address", async () => {
    const user = userEvent.setup();
    const onChooseKind = vi.fn();
    const onBackToKinds = vi.fn();
    const { rerender } = renderWithProviders(
      <WidgetModal
        open
        widget={null}
        datasets={DATASETS}
        kinds={ALL_KINDS}
        saving={false}
        period="30d"
        resources={explorerCatalogue.items}
        onClose={vi.fn()}
        onSave={vi.fn()}
        chosenKind={null}
        onChooseKind={onChooseKind}
        onBackToKinds={onBackToKinds}
      />,
    );
    await user.click(screen.getByTestId("widget-tile-MAIL"));
    expect(onChooseKind).toHaveBeenCalledWith("MAIL");
    rerender(
      <WidgetModal
        open
        widget={null}
        datasets={DATASETS}
        kinds={ALL_KINDS}
        saving={false}
        period="30d"
        resources={explorerCatalogue.items}
        onClose={vi.fn()}
        onSave={vi.fn()}
        chosenKind="MAIL"
        onChooseKind={onChooseKind}
        onBackToKinds={onBackToKinds}
      />,
    );
    expect(await screen.findByText(/Step 2 of 2 · mail/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBackToKinds).toHaveBeenCalled();
  });
});

describe("every kind saves the config its widget reads", () => {
  it.each(ALL_KINDS)("%s", async (kind) => {
    const user = userEvent.setup();
    // Saved searches are empty by default (every entity list mounts them).
    server.use(
      http.get("/platform/api/saved-searches", () =>
        HttpResponse.json({ items: [{ id: "ss-1", name: "Open escalations", resource_type: "ticket" }], total: 1 }),
      ),
    );
    const { onSave } = open();
    await user.click(screen.getByTestId(`widget-tile-${kind}`));
    fireEvent.change(screen.getByPlaceholderText("Open tickets by severity"), { target: { value: `Ünïcode ${kind} ✓` } });

    const needs = KINDS[kind].needs;
    if (needs === "report") await chooseFirst("Report");
    if (needs === "search") await chooseFirst("Saved search");
    if (needs === "insight") await chooseFirst("Insight");

    await user.click(screen.getByTestId("save-widget"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]![0];
    expect(saved.kind).toBe(kind);
    expect(saved.title).toBe(`Ünïcode ${kind} ✓`);
    // A new widget lets the server size it; only its column is said.
    expect(saved.x).toBe(0);
    if (needs === "report") expect(saved.config?.report_id).toBeTruthy();
    if (needs === "search") expect(saved.config?.search_id).toBeTruthy();
    if (needs === "insight") expect(saved.config?.insight_id).toBeTruthy();
    if (needs === "dataset") expect(saved.config?.entity).toBe("ticket");
  });

  it("will not add a widget that does not say what it answers", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    await user.click(screen.getByTestId("widget-tile-KPI"));
    await user.click(screen.getByTestId("save-widget"));
    expect(await screen.findByText("Say what this widget answers")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("will not add a report widget with no report chosen", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    await user.click(screen.getByTestId("widget-tile-REPORT"));
    fireEvent.change(screen.getByPlaceholderText("Open tickets by severity"), { target: { value: "Weekly" } });
    await user.click(screen.getByTestId("save-widget"));
    expect(await screen.findByText("Pick a report to draw")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("configuring a widget already on the dashboard", () => {
  const EXISTING: DashboardWidget[] = [
    widget("KPI", { entity: "ticket", metric: "count", period: "7d" }),
    widget("CHART", { entity: "order", chart: "line", dimension: "status", stack: "channel" }),
    widget("HEATMAP", { entity: "ticket", dimension: "priority", stack: "status" }),
    widget("TASKS", { board_id: "board-1", status: "TODO" }),
    widget("MAIL", { folder: "INBOX", unread_only: true }),
    widget("NOTIFICATIONS", { category: "SYSTEM", unread_only: true }),
    widget("ANNOUNCEMENTS", { category: "HR" }),
    widget("PROJECTS", { status: "ACTIVE" }),
    widget("CALENDAR", { days: 14 }),
    widget("FAVORITES", { view: "recent" }),
    widget("EXPLORER", { entity: "customer" }),
    widget("REPORT", { report_id: "rep-1" }),
    widget("SEARCH", { search_id: "ss-1" }),
    widget("INSIGHT", { insight_id: "ins-1" }),
  ].filter((item) => item.kind in KINDS);

  it.each(EXISTING.map((item) => [item.kind, item] as const))("%s opens on its own form and keeps its place", async (_kind, existing) => {
    const user = userEvent.setup();
    const { onSave } = open({ widget: existing });
    expect(screen.getByText(`Configure ${existing.title}`)).toBeInTheDocument();
    expect(screen.queryByTestId("widget-kind-tiles")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue(existing.title)).toBeInTheDocument();
    await user.click(screen.getByTestId("save-widget"));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]![0];
    expect(saved.kind).toBe(existing.kind);
    // An edited widget keeps where the reader put it.
    expect(saved).not.toHaveProperty("x");
    expect(saved.subtitle).toBe("A note");
  });

  it("asks before throwing away an edit, and closes silently when nothing changed", async () => {
    const user = userEvent.setup();
    const { onClose } = open({ widget: EXISTING[0]! });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByDisplayValue(EXISTING[0]!.title), { target: { value: "Changed" } });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect((await screen.findAllByText("Discard your changes?")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
