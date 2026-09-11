import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import ReportBuilderPage from "@/pages/ReportBuilderPage";
import ReportsPage from "@/pages/ReportsPage";
import { CommandProvider } from "@/commands/CommandContext";
import {
  renderedDocuments,
  resetDashboards,
  resetReports,
  savedDashboards,
  savedDocuments,
  savedReports,
} from "@/test/handlers";
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

describe("the report builder — a document, not a chart", () => {
  /**
   * The page and `/charts/builder` used to be the same screen with two names.
   * What is asserted here is the difference: a document is a *page* — blocks
   * in an order, on paper with a header and a footer — and it exports as a
   * file. The question it draws is still owned by the chart builder, and a
   * report block only names one.
   */
  it("opens on the documents somebody composed, not on a dataset picker", async () => {
    render("/reports/builder");
    const gallery = await screen.findByTestId("document-gallery");
    expect(within(gallery).getByText("Quarterly review")).toBeInTheDocument();
    // Somebody else's, which a reader may open and copy but not change.
    expect(within(gallery).getByText("Board pack")).toBeInTheDocument();
  });

  it("composes a page out of blocks, and previews it as paper", async () => {
    const user = userEvent.setup();
    render("/reports/builder?doc=doc-1");

    const paper = await screen.findByTestId("document-paper");
    // The starter blocks are drawn on the page itself, not merely listed.
    expect(within(paper).getByText("Summary")).toBeInTheDocument();
    expect(within(paper).getByText("What this report covers.")).toBeInTheDocument();

    await user.click(screen.getByTestId("add-block"));
    await user.click(await screen.findByRole("menuitem", { name: /A saved report/ }));

    // The new block is in the outline, on the page, and selected — so the rail
    // is already showing the one question it needs answering.
    expect(await screen.findByTestId("outline-b3")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Report" })).toBeInTheDocument();
  });

  it("saves the blocks and the paper together, because they are one document", async () => {
    const user = userEvent.setup();
    render("/reports/builder?doc=doc-1");
    await screen.findByTestId("document-paper");

    // Nothing has changed yet, so there is nothing to save.
    expect(screen.getByTestId("save-document")).toBeDisabled();

    await user.click(screen.getByLabelText("Number the pages"));
    await waitFor(() => expect(screen.getByTestId("save-document")).toBeEnabled());
    await user.click(screen.getByTestId("save-document"));

    await waitFor(() => {
      const stored = savedDocuments.find((item) => item["id"] === "doc-1");
      expect((stored?.["page"] as { page_numbers: boolean }).page_numbers).toBe(false);
    });
  });

  it("exports the document, carrying the charts the browser drew", async () => {
    const user = userEvent.setup();
    render("/reports/builder?doc=doc-1");
    await screen.findByTestId("document-paper");

    await user.click(screen.getByTestId("export-pdf"));

    await waitFor(() => expect(renderedDocuments).toHaveLength(1));
    // The format is the request's; the images map is present even when empty,
    // because a document of prose has no charts to capture and that is not an
    // error — the server renders every data block's numbers instead.
    expect(renderedDocuments[0]).toMatchObject({ format: "pdf" });
    expect(renderedDocuments[0]).toHaveProperty("images");
  });

  it("asks a chart block its own question, out of the analysis catalogue", async () => {
    const user = userEvent.setup();
    render("/reports/builder?doc=doc-1");
    await screen.findByTestId("document-paper");

    await user.click(screen.getByTestId("add-block"));
    await user.click(await screen.findByRole("menuitem", { name: /Chart/ }));

    // The rail asks the four things the chart builder asks, in its words —
    // and it asks them here rather than sending somebody to another screen to
    // save a report first, which is what a REPORT block requires.
    const dataset = await screen.findByRole("combobox", { name: "Dataset" });
    await user.click(dataset);
    await user.click(await screen.findByTitle("Orders"));

    const groupBy = screen.getByRole("combobox", { name: "Group by" });
    await user.click(groupBy);
    await user.click(await screen.findByTitle("Channel"));

    // A question is enough to draw one: the block goes from "nothing to group
    // by" to a picture without anything being saved anywhere.
    await waitFor(() =>
      expect(screen.queryByText("Nothing to group by yet")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByTestId("save-document"));
    await waitFor(() => {
      const stored = savedDocuments.find((item) => item["id"] === "doc-1");
      const blocks = stored?.["blocks"] as Record<string, unknown>[];
      expect(blocks.at(-1)).toMatchObject({
        kind: "CHART",
        entity: "order",
        dimension: "channel",
        aggregation: "count",
      });
    });
  });

  it("offers only the shapes the question can actually feed", async () => {
    const user = userEvent.setup();
    render("/reports/builder?doc=doc-1");
    await screen.findByTestId("document-paper");

    await user.click(screen.getByTestId("add-block"));
    await user.click(await screen.findByRole("menuitem", { name: /Chart/ }));

    await user.click(await screen.findByRole("combobox", { name: "Dataset" }));
    await user.click(await screen.findByTitle("Orders"));
    await user.click(screen.getByRole("combobox", { name: "Group by" }));
    await user.click(await screen.findByTitle("Channel"));

    const strip = await screen.findByLabelText("Visualization");
    // A category can be a bar or a pie. It cannot be a line: a line of
    // categories implies an order the categories do not have, so the kind is
    // not offered rather than being offered and silently ignored.
    expect(within(strip).getByTitle("bar")).toBeInTheDocument();
    expect(within(strip).getByTitle("pie")).toBeInTheDocument();
    expect(within(strip).queryByTitle("line")).not.toBeInTheDocument();
  });

  it("composes a whole draft from a dataset, rather than opening on a blank page", async () => {
    const user = userEvent.setup();
    render("/reports/builder");
    await screen.findByTestId("document-gallery");

    await user.click(screen.getByTestId("compose-document"));
    // It says what it will produce before it produces it.
    expect(await screen.findByText(/A draft about orders/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Compose it" }));

    // What comes back is opened, and it is a page of ordinary blocks — not a
    // preview of something that has to be accepted.
    const paper = await screen.findByTestId("document-paper");
    expect(within(paper).getByText("Orders")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("outline-b4")).toBeInTheDocument());
    // Including the chart, which is editable the way a hand-placed one is.
    await user.click(screen.getByRole("button", { name: /order by channel/ }));
    expect(await screen.findByRole("combobox", { name: "Group by" })).toBeInTheDocument();
  });

  it("offers a copy rather than an edit on somebody else's document", async () => {
    render("/reports/builder?doc=doc-2");
    await screen.findByTestId("document-paper");

    // Read-only says so, and says what to do about it — rather than showing
    // controls that refuse (§76).
    expect(screen.getByText("This document is read-only for you")).toBeInTheDocument();
    expect(screen.queryByTestId("save-document")).not.toBeInTheDocument();
    // Addressed by test id: the icon contributes its own label, so the
    // accessible name reads "copy Make a copy" — the trap the export control
    // documents.
    expect(screen.getByTestId("copy-document")).toBeInTheDocument();
  });
});
