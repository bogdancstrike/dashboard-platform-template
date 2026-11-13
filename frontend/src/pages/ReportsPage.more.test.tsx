import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import ReportsPage from "@/pages/ReportsPage";
import { resetReports, savedReports } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The reports list beyond its first answer (§45): narrowing the list, the
 * actions on a report, and what the page says when it cannot load or run one.
 */
function Where() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function render(route = "/reports") {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/builder" element={<div>the builder</div>} />
      </Routes>
      <Where />
    </>,
    { route },
  );
}

afterEach(() => resetReports());

const rows = () => within(screen.getByTestId("reports")).getAllByRole("row").slice(1);

describe("narrowing the list", () => {
  it("searches by name, owner or dataset, and says when nothing matches", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Revenue by channel", { selector: "td *, td" });
    await user.type(screen.getByRole("textbox", { name: "Filter reports" }), "mara");
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("Tickets by severity");
    await user.clear(screen.getByRole("textbox", { name: "Filter reports" }));
    await user.type(screen.getByRole("textbox", { name: "Filter reports" }), "ünïcode-nothing");
    expect(await screen.findByText("Nothing matches “ünïcode-nothing”")).toBeInTheDocument();
  });

  it("splits mine from shared with me, and refuses an empty view", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText("Revenue by channel", { selector: "td *, td" });
    await user.click(screen.getByRole("button", { name: /Shared with me/ }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("Tickets by severity");
    await user.click(screen.getByRole("button", { name: /Mine/ }));
    await waitFor(() => expect(rows()[0]).toHaveTextContent("Revenue by channel"));
    // Nothing is scheduled in the fixture, so that view cannot be chosen.
    expect(screen.getByRole("button", { name: /Scheduled/ })).toBeDisabled();
  });

  it("opens a report from the keyboard", async () => {
    render();
    await screen.findByText("Tickets by severity", { selector: "td *, td" });
    const row = rows().find((node) => node.textContent?.includes("Tickets by severity"))!;
    fireEvent.keyDown(row, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("report=report-2"));
  });

  it("offers the first report when there are none", async () => {
    const user = userEvent.setup();
    server.use(http.get("/platform/api/reports", () => HttpResponse.json({ items: [], total: 0, visualizations: [], can_create: true, can_share: true })));
    render();
    await user.click(await screen.findByRole("button", { name: "Build the first one" }));
    expect(screen.getByTestId("where")).toHaveTextContent("/reports/builder");
  });
});

describe("acting on a report", () => {
  async function action(name: string, item: RegExp) {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: `Actions for ${name}` }));
    await user.click(await screen.findByRole("menuitem", { name: item }));
  }

  it("copies a colleague's report and opens the copy", async () => {
    render("/reports?report=report-2");
    await action("Tickets by severity", /Make a copy|Duplicate|Copy/);
    expect(await screen.findByText(/is yours to change/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("report=report-2-copy"));
  });

  it("edits its own report in the builder", async () => {
    render("/reports?report=report-1");
    await action("Revenue by channel", /Edit/);
    expect(screen.getByTestId("where")).toHaveTextContent("/reports/builder?id=report-1");
  });

  it("deletes its own report after asking", async () => {
    const user = userEvent.setup();
    render("/reports?report=report-1");
    await action("Revenue by channel", /Delete/);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Report deleted")).toBeInTheDocument();
    expect(savedReports.map((item) => item["id"])).not.toContain("report-1");
  });

  it("reports a refused copy in the server's words", async () => {
    server.use(
      http.post("/platform/api/reports/:id/duplicate", () =>
        HttpResponse.json({ error: "forbidden", message: "Copying is switched off for your role." }, { status: 403 }),
      ),
    );
    render("/reports?report=report-2");
    await action("Tickets by severity", /Make a copy|Duplicate|Copy/);
    expect(await screen.findByText("Copying is switched off for your role.")).toBeInTheDocument();
  });
});

describe("when something fails", () => {
  it("names the missing permission and retries the list", async () => {
    const user = userEvent.setup();
    let calls = 0;
    server.use(
      http.get("/platform/api/reports", () => {
        calls += 1;
        return HttpResponse.json({ error: "forbidden", message: "Your role cannot see reports.", details: { missing: ["reports.view"] } }, { status: 403 });
      }),
    );
    render();
    expect(await screen.findByText("Your role cannot see reports.")).toBeInTheDocument();
    expect(screen.getByText("Missing: reports.view")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBeGreaterThan(1));
  });

  it("says a report could not be run, with the kind of failure", async () => {
    server.use(
      http.post("/platform/api/reports/:id/run", () => HttpResponse.json({ error: "not_found", message: "Gone." }, { status: 404 })),
    );
    render("/reports?report=report-1");
    expect(await screen.findByText("That report has been deleted")).toBeInTheDocument();
  });
});
