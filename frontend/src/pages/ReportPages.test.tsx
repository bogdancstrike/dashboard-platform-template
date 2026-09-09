import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import ReportBuilderPage from "@/pages/ReportBuilderPage";
import ReportsPage from "@/pages/ReportsPage";
import { CommandProvider } from "@/commands/CommandContext";
import { resetDashboards, resetReports, savedDashboards, savedReports } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Saved reports and the builder (§28).
 *
 * The two claims worth testing are the ones a screenshot cannot show: that a
 * report's answer comes from the shared analysis compiler with the stored
 * definition as its input, and that what gets saved is exactly what was
 * previewed.
 */
function Address() {
  const location = useLocation();
  return <span data-testid="address">{location.pathname + location.search}</span>;
}

function render(route: string) {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/builder" element={<ReportBuilderPage />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => {
  resetReports();
  resetDashboards();
});

describe("the reports page", () => {
  it("lists saved questions and answers the open one", async () => {
    render("/reports");

    const list = await screen.findByTestId("reports");
    // The name appears in the list and again as the open report's heading.
    expect(within(list).getAllByText("Revenue by channel").length).toBeGreaterThan(0);
    expect(within(list).getByText("Tickets by severity")).toBeInTheDocument();
    // Opening one runs it: the page answers a question rather than listing
    // names and making somebody click through five to find the one they meant.
    expect(await screen.findByTestId("report-matched")).toHaveTextContent(/rows measured/);
  });

  it("says who else can see a report rather than leaving it to be guessed", async () => {
    render("/reports");

    const list = await screen.findByTestId("reports");
    // In the *list*, only the exceptions are marked. Private is the default
    // and was tagged on every single row — a label every row shares is a
    // label nobody reads, and it cost the row the space its name needed.
    expect(within(list).getAllByLabelText("Public").length).toBeGreaterThan(0);
    expect(within(list).queryByLabelText("Private")).not.toBeInTheDocument();

    // The open report says it in words, where there is room for words.
    expect(await within(list).findByText(/^(Private|Shared|Public)$/)).toBeInTheDocument();
  });

  it("runs the report through the shared compiler, with its stored definition", async () => {
    const asked: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/reports/:id/run", ({ params }) => {
        asked.push({ id: params["id"] });
        const report = savedReports[0]!;
        return HttpResponse.json({
          report,
          result: {
            resource_type: "order",
            resource_label: "Orders",
            path: "/orders",
            dimensions: [{ field: "channel", label: "Channel", kind: "enum", granularity: "" }],
            measures: [
              { key: "sum:total", label: "total", aggregation: "sum", field: "total", format: "number" },
            ],
            rows: [{ keys: ["PORTAL"], values: { "sum:total": 42 } }],
            totals: { "sum:total": 42 },
            matched: 7,
            truncated: false,
            other: null,
            period: { key: "last_90_days", field: "placed_at", from: null, to: null },
            description: "total of orders, by channel",
            generated_at: "2026-09-06T12:00:00Z",
          },
        });
      }),
    );

    render("/reports");

    await waitFor(() => expect(asked).toHaveLength(1));
    expect(await screen.findByTestId("report-matched")).toHaveTextContent("7 rows measured");
  });

  it("offers only the actions the reader may take on somebody else's report", async () => {
    const user = userEvent.setup();
    render("/reports?report=report-2");

    await screen.findByTestId("reports");
    await user.click(screen.getByRole("button", { name: "Actions for Tickets by severity" }));

    // A member reads and duplicates; only the owner edits or deletes (§5).
    expect(await screen.findByRole("menuitem", { name: /Edit/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("menuitem", { name: /Duplicate/ })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("puts a saved report on a dashboard from where the report is (§45)", async () => {
    // The reference, not a rebuilt question: the widget names the report and
    // the dashboard runs the report's own stored definition.
    const user = userEvent.setup();
    const sent: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/dashboards/:id/widgets", async ({ request }) => {
        sent.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(savedDashboards[0], { status: 201 });
      }),
    );
    render("/reports?report=report-1");

    await screen.findByTestId("reports");
    await user.click(screen.getByRole("button", { name: /^Actions for / }));
    await user.click(await screen.findByRole("menuitem", { name: /Add to a dashboard/ }));

    // The modal offers the reader's own dashboards by name.
    await user.click(await screen.findByRole("radio", { name: /Support desk/ }));
    await user.click(screen.getByTestId("add-to-dashboard-confirm"));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ kind: "REPORT", config: { report_id: "report-1" } });
  });
});

describe("the report builder", () => {
  it("previews the question as it is composed, server-side", async () => {
    const user = userEvent.setup();
    const asked: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/analysis/run", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        asked.push(body);
        const { analysisResult } = await import("@/test/handlers");
        return HttpResponse.json(analysisResult(body));
      }),
    );

    render("/reports/builder");
    await screen.findByTestId("report-question");

    await user.click(screen.getByRole("combobox", { name: "Group by" }));
    await user.click(await screen.findByTitle("Channel"));

    await waitFor(() =>
      expect(asked.some((body) => JSON.stringify(body["dimensions"]).includes("channel"))).toBe(true),
    );
  });

  it("saves exactly what was previewed", async () => {
    const user = userEvent.setup();
    const posted: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/reports", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        posted.push(body);
        return HttpResponse.json({ ...savedReports[0], ...body, id: "report-new" }, { status: 201 });
      }),
    );

    render("/reports/builder?resource=order&group=status&agg=count&period=last_30_days&chart=pie");
    await screen.findByTestId("report-question");

    // Saving is a dialog from the header now: on a page whose purpose is to
    // produce the thing this button saves, the button was below the fold.
    await user.click(screen.getByTestId("open-save-report"));
    await user.type(await screen.findByLabelText("Name"), "Orders by status");
    await user.click(screen.getByTestId("save-report"));

    await waitFor(() => expect(posted).toHaveLength(1));
    // The definition sent is the one the preview ran — there is no step in
    // between that could reinterpret it.
    expect(posted[0]).toMatchObject({
      name: "Orders by status",
      resource_type: "order",
      dimensions: [{ field: "status", granularity: "" }],
      metrics: [{ aggregation: "count" }],
      period: "last_30_days",
      visualization: "pie",
    });
    // And it lands on the saved report rather than leaving the form open.
    expect(await screen.findByTestId("address")).toHaveTextContent("/reports?report=report-new");
  });

  it("keeps the draft in the URL, so a half-built report can be pasted", async () => {
    const user = userEvent.setup();
    render("/reports/builder");
    await screen.findByTestId("report-question");

    await user.click(screen.getByRole("combobox", { name: "Group by" }));
    await user.click(await screen.findByTitle("Channel"));

    expect(screen.getByTestId("address")).toHaveTextContent("group=channel");
  });

  it("will not let an aggregation be saved without the column it measures", async () => {
    const user = userEvent.setup();
    render("/reports/builder?resource=order&agg=sum");
    await screen.findByTestId("report-question");

    // Refused at the door: the header's save button is disabled and the page
    // says what is missing, rather than opening a dialog that cannot succeed.
    expect(screen.getByTestId("open-save-report")).toBeDisabled();
    expect(screen.getByText("Pick a column to measure")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Measured column" }));
    await user.click(await screen.findByTitle("Total"));

    await waitFor(() => expect(screen.getByTestId("open-save-report")).toBeEnabled());
  });
});
