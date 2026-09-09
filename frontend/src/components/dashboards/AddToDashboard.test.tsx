import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it } from "vitest";

import {
  AddToDashboard,
  describeHolding,
  type DashboardSubject,
} from "@/components/dashboards/AddToDashboard";
import type { SavedDashboard } from "@/api/dashboards";
import { resetDashboards, savedDashboards } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * "And put that one on my dashboard" (§45).
 *
 * The dashboard half of this was already right: a `REPORT` widget names a
 * saved report and runs the report's *stored* definition, so the picture is
 * the one that was saved. What was missing was the gesture — a reader had to
 * leave the chart, open `/dashboards`, add a widget, choose "A saved report"
 * and find theirs in a select, which is how a chart ends up being rebuilt in
 * the widget drawer instead. A rebuilt chart is a second definition of one
 * question, and it drifts the first time either copy is edited.
 *
 * What is worth asserting is that the widget carries a *reference*: the
 * request must name the report and describe nothing.
 */

const REPORT: DashboardSubject = { kind: "REPORT", id: "report-7", title: "Orders by status" };

function render(subject: DashboardSubject = REPORT) {
  return renderWithProviders(
    <AddToDashboard open subject={subject} onClose={() => undefined} />,
  );
}

afterEach(() => resetDashboards());

describe("adding a saved thing to a dashboard", () => {
  it("names the report and copies none of its question", async () => {
    const user = userEvent.setup();
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/dashboards/:id/widgets", async ({ request, params }) => {
        sent.push({ id: String(params["id"]), ...(await request.json() as object) });
        return HttpResponse.json({ ...savedDashboards[0], id: String(params["id"]) }, { status: 201 });
      }),
    );
    render();

    await user.click(await screen.findByRole("radio", { name: /Support desk/ }));
    await user.click(screen.getByTestId("add-to-dashboard-confirm"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      id: "dash-1",
      kind: "REPORT",
      title: "Orders by status",
      config: { report_id: "report-7" },
    });
    // No question in the widget: no dimension, no aggregation, no dataset.
    expect(Object.keys(sent[0]!["config"] as object)).toEqual(["report_id"]);
  });

  it("puts a saved search on one by the same route", async () => {
    const user = userEvent.setup();
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/dashboards/:id/widgets", async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(savedDashboards[0], { status: 201 });
      }),
    );
    render({ kind: "SEARCH", id: "search-3", title: "Overdue in EMEA" });

    await user.click(await screen.findByRole("radio", { name: /Support desk/ }));
    await user.click(screen.getByTestId("add-to-dashboard-confirm"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ kind: "SEARCH", config: { search_id: "search-3" } });
  });

  it("creates the dashboard already holding it, in one request", async () => {
    const user = userEvent.setup();
    const created: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/dashboards", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        created.push(body);
        return HttpResponse.json({ ...savedDashboards[0], id: "dash-new", name: body["name"] }, { status: 201 });
      }),
    );
    render();

    await user.click(await screen.findByRole("radio", { name: /A new dashboard/ }));
    await user.clear(screen.getByLabelText("New dashboard name"));
    await user.type(screen.getByLabelText("New dashboard name"), "Trading floor");
    await user.click(screen.getByTestId("add-to-dashboard-confirm"));

    // One request, so a new dashboard is never left empty because a second
    // call failed.
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toMatchObject({
      name: "Trading floor",
      widgets: [{ kind: "REPORT", config: { report_id: "report-7" } }],
    });
  });

  it("offers only the dashboards this reader may change", async () => {
    // A dashboard shared *with* somebody is readable and not writable, and
    // offering it would be an option that fails on the last press (§76).
    savedDashboards[1]!["can_edit"] = false;
    savedDashboards[1]!["name"] = "Somebody else's board";
    render();

    expect(await screen.findByRole("radio", { name: /Support desk/ })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Somebody else/ })).not.toBeInTheDocument();
  });

  it("says so when there is nowhere to put it and nothing to create", async () => {
    server.use(
      http.get("/platform/api/dashboards", () =>
        HttpResponse.json({
          items: [], total: 0, widget_kinds: [], columns: 12, datasets: [],
          can_create: false, can_share: false,
        }),
      ),
    );
    render();

    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent("There is no dashboard you may change");
    // The permission, in words, and no button that would fail.
    expect(empty).toHaveTextContent("dashboards.manage");
    expect(screen.queryByTestId("add-to-dashboard-confirm")).not.toBeInTheDocument();
  });

  it("explains a refused add, with the id to quote", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/platform/api/dashboards/:id/widgets", () =>
        HttpResponse.json(
          { error: "forbidden", message: "refused", details: { missing: ["dashboards.manage"] } },
          { status: 403, headers: { "X-Correlation-ID": "pin-trace" } },
        ),
      ),
    );
    render();

    await user.click(await screen.findByRole("radio", { name: /Support desk/ }));
    await user.click(screen.getByTestId("add-to-dashboard-confirm"));

    const failure = await screen.findByTestId("failure-alert");
    expect(failure).toHaveAttribute("data-failure", "forbidden");
    expect(failure).toHaveTextContent("Your role does not include dashboards.manage");
    expect(failure).toHaveTextContent("pin-trace");
  });

  it("tells the reader what is on each dashboard, not how many things", () => {
    // "alerts, revenue and a heatmap" is recognisable; "7 widgets" is not.
    const board = (extra: Partial<SavedDashboard>) =>
      ({ widget_count: 3, widget_kinds: ["KPI", "ALERTS"], ...extra }) as SavedDashboard;

    expect(describeHolding(board({ widget_count: 0, widget_kinds: [] }))).toBe("Empty so far");
    expect(describeHolding(board({}))).toBe("headline number, needs attention");
    expect(
      describeHolding(board({ widget_kinds: ["KPI", "ALERTS", "LIST", "TABLE", "GAUGE"] })),
    ).toMatch(/and more$/);
    // Each kind once, however many cards of it there are.
    expect(describeHolding(board({ widget_kinds: ["KPI", "KPI", "KPI"] }))).toBe(
      "headline number",
    );
  });
});
