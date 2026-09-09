import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { Route, Routes, useSearchParams } from "react-router-dom";

import QualityPage, { ranked, summarise } from "@/pages/admin/QualityPage";
import type { QualityFinding, QualityOverview } from "@/api/quality";
import { CommandProvider } from "@/commands/CommandContext";
import { server } from "@/test/server";
import { renderWithProviders } from "@/test/render";

/**
 * Data quality (§65).
 *
 * Four claims, and each is a way this page could be useless instead:
 *
 * **Every count opens the rows it counted.** The check is declared as the
 * list's own filter, so the link is the same question. A count nobody can open
 * is a count nobody can fix (§44).
 *
 * **A check that cannot be a link says why, and names the records instead.**
 * `spent > budget` compares two columns; a link that quietly returned
 * different rows would be worse than none.
 *
 * **The passing checks are drawn.** A page listing only problems cannot be
 * told apart from a page whose checks are broken.
 *
 * **Order is by severity, not by count.** One contradiction matters more than
 * four hundred missing phone numbers, and sorting by size buries it.
 */

function Address() {
  const [params] = useSearchParams();
  return <span data-testid="address">{params.toString()}</span>;
}

function render(route = "/admin/quality") {
  return renderWithProviders(
    <CommandProvider>
      <Address />
      <Routes>
        <Route path="/admin/quality" element={<QualityPage />} />
        <Route path="/orders" element={<div>the order ledger</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

function finding(overrides: Partial<QualityFinding>): QualityFinding {
  return {
    key: "k",
    resource_type: "order",
    resource_label: "Orders",
    title: "Something",
    why: "Because.",
    fix: "Do this.",
    severity: "WARNING",
    count: 1,
    link: "/orders",
    why_no_link: "",
    sample: [],
    ...overrides,
  };
}

describe("the order findings are read in", () => {
  it("puts a contradiction above a bigger warning", () => {
    const sorted = ranked([
      finding({ key: "big", severity: "WARNING", count: 400 }),
      finding({ key: "small", severity: "CRITICAL", count: 1 }),
      finding({ key: "note", severity: "INFO", count: 90 }),
    ]);
    // One order shipped and never paid matters more than four hundred missing
    // phone numbers. Sorting by count would bury it.
    expect(sorted.map((entry) => entry.key)).toEqual(["small", "big", "note"]);
  });

  it("breaks a tie by size, so the worst of a grade is first", () => {
    const sorted = ranked([
      finding({ key: "few", severity: "WARNING", count: 2 }),
      finding({ key: "many", severity: "WARNING", count: 40 }),
    ]);
    expect(sorted.map((entry) => entry.key)).toEqual(["many", "few"]);
  });
});

describe("what the page says it looked at", () => {
  it("names the number of checks, not only the failures", () => {
    // "14 checks, 8 with something in them" is a sentence somebody can trust.
    // A list of eight is not: it cannot be told from a page that failed to
    // look at the other six.
    const said = summarise({
      totals: { checks: 14, failing: 8, records: 51, by_severity: {} },
    } as unknown as QualityOverview);
    expect(said).toContain("14 checks");
    expect(said).toContain("8 with something in them");
  });

  it("says so plainly when there is nothing to report", () => {
    const said = summarise({
      totals: { checks: 14, failing: 0, records: 0, by_severity: {} },
    } as unknown as QualityOverview);
    expect(said).toBe("14 checks, and nothing to report");
  });

  it("says nothing at all before the checks have run", () => {
    expect(summarise(undefined)).toBe("");
  });
});

describe("the page", () => {
  it("leads with what it checked and what it found", async () => {
    render();
    const totals = await screen.findByTestId("quality-totals");
    expect(within(totals).getByText("Checks run")).toBeInTheDocument();
    expect(within(totals).getByText("Contradictions")).toBeInTheDocument();
  });

  it("opens the rows a count counted", async () => {
    const user = userEvent.setup();
    render();
    const open = await screen.findByTestId("quality-open-order_shipped_unpaid");
    // The check *is* the filter, so this is the same question rather than a
    // second query that will one day disagree with the number beside it — and
    // it carries where it came from, so the ledger offers one press back to
    // this report (§44).
    expect(open).toHaveAttribute(
      "href",
      "/orders?f.fulfilment_status=SHIPPED&f.payment_status=UNPAID&from=%2Fadmin%2Fquality",
    );

    await user.click(open);
    expect(await screen.findByText("the order ledger")).toBeInTheDocument();
  });

  it("names the records when a filter cannot express the check", async () => {
    render();
    await screen.findByTestId("quality-project_overspent");
    // No link, because `spent > budget` compares two columns — and the page
    // says that rather than offering a link to the wrong rows.
    expect(screen.queryByTestId("quality-open-project_overspent")).not.toBeInTheDocument();
    const sample = screen.getByTestId("quality-sample-project_overspent");
    expect(within(sample).getByRole("link", { name: "PRJ-0001" })).toHaveAttribute(
      "href",
      "/projects/project-1",
    );
    expect(screen.getByText(/compares two columns/)).toBeInTheDocument();
  });

  it("says what to do about each finding", async () => {
    render();
    const card = await screen.findByTestId("quality-order_shipped_unpaid");
    // A finding with no remedy is a complaint, and a page of complaints is a
    // page nobody opens twice.
    expect(within(card).getByText(/Chase the payment/)).toBeInTheDocument();
  });

  it("draws the checks that came back empty", async () => {
    render();
    const passing = await screen.findByTestId("quality-passing");
    expect(passing).toHaveTextContent("No email address");
  });

  it("narrows to one dataset through the address", async () => {
    const user = userEvent.setup();
    render();
    await screen.findByTestId("quality-findings");

    // The label, not the radio: AntD's Segmented puts `pointer-events: none`
    // on the input and lets the label take the click, which is what a person
    // does anyway — documented in `NotificationsPage.test`.
    await user.click(
      screen.getByText(/Tickets/, { selector: ".ant-segmented-item-label" }),
    );
    // In the URL, so a narrowed page is a link — and it is the address a
    // list's own indicator points at (§69).
    await waitFor(() =>
      expect(screen.getByTestId("address")).toHaveTextContent("resource_type=ticket"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("quality-order_shipped_unpaid")).not.toBeInTheDocument(),
    );
  });

  it("opens straight onto the dataset an address names", async () => {
    render("/admin/quality?resource_type=order");
    expect(await screen.findByTestId("quality-order_shipped_unpaid")).toBeInTheDocument();
    expect(screen.queryByTestId("quality-ticket_unassigned_open")).not.toBeInTheDocument();
  });

  it("gives a clean bill rather than an empty page", async () => {
    server.use(
      http.get("/platform/admin/quality", () =>
        HttpResponse.json({
          resource_type: "",
          generated_at: "2026-09-09T04:00:00Z",
          findings: [
            {
              key: "customer_no_email", resource_type: "customer", resource_label: "Customers",
              title: "No email address", why: "Nothing sent can reach them.", fix: "Add one.",
              severity: "INFO", count: 0, link: "/customers", why_no_link: "", sample: [],
            },
          ],
          totals: { checks: 1, failing: 0, records: 0,
                    by_severity: { CRITICAL: 0, WARNING: 0, INFO: 0 } },
          datasets: [],
        }),
      ),
    );
    render();

    const clean = await screen.findByTestId("quality-clean");
    // And it says the checks *ran*, which is the difference between a clean
    // bill and a page that failed to look.
    expect(clean).toHaveTextContent("All 1 checks came back empty");
    expect(screen.getByTestId("quality-passing")).toBeInTheDocument();
  });

  it("says so when the checks could not be run", async () => {
    server.use(
      http.get("/platform/admin/quality", () =>
        HttpResponse.json({ error: "error", message: "nope" }, { status: 500 }),
      ),
    );
    render();
    expect(await screen.findByText("The checks could not be run")).toBeInTheDocument();
  });
});
