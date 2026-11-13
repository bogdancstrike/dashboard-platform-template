import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import DashboardsPage from "@/pages/DashboardsPage";
import { resetDashboards, savedDashboards } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The dashboards page beyond its happy path (§45, §67): the gallery's search,
 * sort and owner filters; copying and deleting from a card; every layout
 * control on a widget, by menu and by key; and the failures a page has to
 * say something useful about.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route = "/dashboards") {
  return renderWithProviders(
    <>
      <Address />
      <Routes>
        <Route path="/dashboards" element={<DashboardsPage />} />
      </Routes>
    </>,
    { route },
  );
}

const widgets = () => savedDashboards[0]!["widgets"] as { id: string; x: number; y: number; width: number; height: number; title: string }[];

afterEach(() => resetDashboards());

/** Copying is answered here: the shared fixture has no duplicate endpoint. */
function copies() {
  server.use(
    http.post("/platform/api/dashboards/:id/duplicate", ({ params }) => {
      const source = savedDashboards.find((item) => item["id"] === params["id"])!;
      const copy = { ...source, id: `dash-${savedDashboards.length + 1}`, name: `${String(source["name"])} (copy)`, can_edit: true };
      savedDashboards.push(copy);
      return HttpResponse.json(copy, { status: 201 });
    }),
  );
}

async function choose(label: string, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const item = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find(
      (node) => node.textContent === option,
    );
    if (!found) throw new Error(`${option} not offered`);
    return found;
  });
  await user.click(item);
}

describe("the gallery", () => {
  it("narrows by a search, sorts, and filters by owner", async () => {
    const user = userEvent.setup();
    render();
    const gallery = await screen.findByTestId("dashboard-gallery");
    expect(within(gallery).getAllByTestId(/^board-card-/)).toHaveLength(2);

    await user.type(screen.getByRole("textbox", { name: "Search dashboards" }), "deliv");
    await waitFor(() => expect(within(screen.getByTestId("dashboard-gallery")).getAllByTestId(/^board-card-/)).toHaveLength(1));
    await user.clear(screen.getByRole("textbox", { name: "Search dashboards" }));
    await user.type(screen.getByRole("textbox", { name: "Search dashboards" }), "ζζζ nothing");
    expect(await screen.findByText("No dashboard matches that")).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "Search dashboards" }));

    await choose("Sort", "Sort: name");
    const names = within(await screen.findByTestId("dashboard-gallery")).getAllByTestId(/^board-card-/).map((card) => card.dataset["testid"]);
    expect(names).toEqual(["board-card-dash-2", "board-card-dash-1"]);
    await choose("Sort", "Sort: most widgets");
    await choose("Owner", "Owner: shared with me");
    await waitFor(() =>
      expect(within(screen.getByTestId("dashboard-gallery")).getAllByTestId(/^board-card-/).map((card) => card.dataset["testid"])).toEqual(["board-card-dash-2"]),
    );
    await choose("Owner", "Owner: me");
    await waitFor(() =>
      expect(within(screen.getByTestId("dashboard-gallery")).getAllByTestId(/^board-card-/).map((card) => card.dataset["testid"])).toEqual(["board-card-dash-1"]),
    );
  });

  it("deletes a dashboard from its card after asking", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Delete Support desk" }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Support desk deleted")).toBeInTheDocument();
    expect(savedDashboards.map((item) => item["id"])).toEqual(["dash-2"]);
  });

  it("copies a colleague's layout from its card", async () => {
    const user = userEvent.setup();
    copies();
    render();
    await user.click(await screen.findByRole("button", { name: "Make a copy of Delivery health" }));
    await user.click(await screen.findByRole("button", { name: "Make a copy" }));
    await waitFor(() => expect(savedDashboards.length).toBe(3));
  });

  it("opens a dashboard's settings straight from its card", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Settings for Support desk" }));
    expect(await screen.findByTestId("save-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("address")).toHaveTextContent("dashboard=dash-1");
  });

  it("offers the first dashboard when there are none", async () => {
    server.use(
      http.get("/platform/api/dashboards", () =>
        HttpResponse.json({ items: [], total: 0, widget_kinds: ["KPI"], columns: 12, datasets: [], can_create: true, can_share: true }),
      ),
    );
    render();
    expect(await screen.findByText("No dashboards yet. One is three steps away.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /New dashboard/ }).length).toBeGreaterThan(0);
  });
});

describe("when something fails", () => {
  it("names the missing permission and the reference when the list is refused", async () => {
    server.use(
      http.get("/platform/api/dashboards", () =>
        HttpResponse.json(
          { error: "forbidden", message: "Your role cannot see dashboards.", details: { missing: ["dashboards.view"] } },
          { status: 403, headers: { "X-Correlation-ID": "corr-123" } },
        ),
      ),
    );
    render();
    expect(await screen.findByText("Your role cannot see dashboards.")).toBeInTheDocument();
    expect(screen.getByText("Missing: dashboards.view")).toBeInTheDocument();
  });

  it("says a dashboard could not be opened and offers the way back", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/platform/api/dashboards/:id", () =>
        HttpResponse.json({ error: "not_found", message: "No dashboard at this address." }, { status: 404 }),
      ),
    );
    render("/dashboards?dashboard=gone");
    expect(await screen.findByText("No dashboard at this address.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All dashboards" }));
    await waitFor(() => expect(screen.getByTestId("address")).not.toHaveTextContent("dashboard=gone"));
  });

  it("reports a refused layout change in the server's words", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/platform/api/dashboards/:id/arrange", () =>
        HttpResponse.json({ error: "conflict", message: "Somebody else rearranged this first." }, { status: 409 }),
      ),
    );
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("toggle-edit"));
    await user.click(within(screen.getByTestId("widget-widget-2")).getByLabelText("Move or resize Tickets by severity"));
    await user.click(await screen.findByRole("menuitem", { name: /Move right/ }));
    expect(await screen.findByText("Somebody else rearranged this first.")).toBeInTheDocument();
  });
});

describe("rearranging a dashboard", () => {
  async function menu(title: string, item: RegExp) {
    const user = userEvent.setup();
    const card = screen.getAllByRole("group").find((node) => node.getAttribute("aria-label")?.startsWith(title));
    await user.click(within(card ?? document.body).getByLabelText(`Move or resize ${title}`));
    await user.click(await screen.findByRole("menuitem", { name: item }));
  }

  it("moves a widget down and back up from its menu", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("toggle-edit"));
    const before = { ...widgets().find((item) => item.id === "widget-2")! };
    await menu("Tickets by severity", /Move down/);
    await waitFor(() => expect(widgets().find((item) => item.id === "widget-2")!.y).toBe(before.y + 1));
    await menu("Tickets by severity", /Move up/);
    await waitFor(() => expect(widgets().find((item) => item.id === "widget-2")!.y).toBe(before.y));
  });

  it("makes a widget taller and wider from its menu", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("toggle-edit"));
    const before = { ...widgets().find((item) => item.id === "widget-2")! };
    await menu("Tickets by severity", /Taller/);
    await waitFor(() => expect(widgets().find((item) => item.id === "widget-2")!.height).toBe(before.height + 1));
    await menu("Tickets by severity", /Wider/);
    await waitFor(() => expect(widgets().find((item) => item.id === "widget-2")!.width).toBe(before.width + 1));
  });

  it("never shrinks a widget below what its kind can be drawn at", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("toggle-edit"));
    await menu("Tickets by severity", /Narrower/);
    await menu("Tickets by severity", /Shorter/);
    await waitFor(() => {
      const after = widgets().find((item) => item.id === "widget-2")!;
      expect(after.width).toBeGreaterThanOrEqual(1);
      expect(after.height).toBeGreaterThanOrEqual(1);
    });
  });

  it("sets a preset size", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("toggle-edit"));
    await user.click(within(screen.getByTestId("widget-widget-2")).getByLabelText("Move or resize Tickets by severity"));
    await user.hover(await screen.findByRole("menuitem", { name: /Set a size/ }));
    const presets = await screen.findAllByRole("menuitem");
    const full = presets.find((node) => /full/i.test(node.textContent ?? "")) ?? presets[presets.length - 1]!;
    await user.click(full);
    await waitFor(() => expect(widgets().find((item) => item.id === "widget-2")!.width).toBeGreaterThan(1));
  });

  it("moves a widget with the arrow keys and resizes it with shift", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("toggle-edit"));
    const card = screen.getAllByRole("group").find((node) => node.getAttribute("aria-label")?.startsWith("Tickets by severity"))!;
    const x = widgets().find((item) => item.id === "widget-2")!.x;
    fireEvent.keyDown(card, { key: "ArrowRight" });
    await waitFor(() => expect(widgets().find((item) => item.id === "widget-2")!.x).toBe(x + 1));
    fireEvent.keyDown(card, { key: "ArrowDown", shiftKey: true });
    await waitFor(() => expect(widgets().find((item) => item.id === "widget-2")!.height).toBeGreaterThan(2));
  });

  it("tidies up and auto-arranges the whole grid", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("toggle-edit"));
    await user.click(screen.getByTestId("tidy-up"));
    await user.click(screen.getByTestId("auto-arrange"));
    await waitFor(() => expect(widgets()).toHaveLength(2));
  });

  it("reconfigures a widget and removes another after asking", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("toggle-edit"));
    await user.click(screen.getByLabelText("Configure Open tickets"));
    const dialog = await screen.findByRole("dialog", { name: /Configure Open tickets/ });
    const title = within(dialog).getByDisplayValue("Open tickets");
    await user.clear(title);
    await user.type(title, "Still open");
    await user.click(within(dialog).getByTestId("save-widget"));
    await waitFor(() => expect(widgets().find((item) => item.id === "widget-1")!.title).toBe("Still open"));

    await user.click(screen.getByLabelText("Remove Tickets by severity"));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(widgets().map((item) => item.id)).toEqual(["widget-1"]));
  });
});

describe("the dashboard's own settings", () => {
  it("deletes the open dashboard from its settings and returns to the gallery", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("board-settings"));
    await user.click(await screen.findByTestId("delete-dashboard"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Support desk deleted")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("address")).not.toHaveTextContent("dashboard=dash-1"));
  });

  it("shares it from the share drawer", async () => {
    const user = userEvent.setup();
    render("/dashboards?dashboard=dash-1");
    await user.click(await screen.findByTestId("board-share"));
    expect(await screen.findByTestId("share-drawer")).toBeInTheDocument();
    // Save waits for a change: an unchanged audience has nothing to send.
    await user.click(screen.getByText("Everyone"));
    await user.click(screen.getByTestId("save-share"));
    await waitFor(() => expect(savedDashboards[0]!["scope"]).toBe("PUBLIC"));
  });

  it("copies a colleague's open dashboard", async () => {
    const user = userEvent.setup();
    copies();
    render("/dashboards?dashboard=dash-2");
    await user.click(await screen.findByTestId("duplicate-dashboard"));
    await user.click(await screen.findByRole("button", { name: "Make a copy" }));
    await waitFor(() => expect(savedDashboards.length).toBe(3));
  });
});
