import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import CustomersPage from "@/pages/entities/CustomersPage";
import DevicesFleetPage from "@/pages/entities/DevicesFleetPage";
import OrdersLedgerPage from "@/pages/entities/OrdersLedgerPage";
import ProjectsPortfolioPage from "@/pages/entities/ProjectsPortfolioPage";
import TasksBoardPage from "@/pages/entities/TasksBoardPage";
import TicketsQueuePage from "@/pages/entities/TicketsQueuePage";
import { CommandProvider } from "@/commands/CommandContext";
import { entityResult } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * Six datasets, six pages (§7).
 *
 * The thing worth asserting is not that each page renders — it is that each
 * renders something the others do not. A suite that only checked for a heading
 * and a row would pass just as happily against the single generic list these
 * replaced, which is the failure mode this whole change exists to fix.
 */
function render(page: React.ReactNode, route: string, detail = "/:id") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path={route} element={page} />
        <Route path={`${route}${detail}`} element={<div>the record</div>} />
        <Route path="/explore" element={<div>the explorer</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

describe("tasks — the board", () => {
  it("draws one lane per declared status, not per status present in the page", async () => {
    render(<TasksBoardPage />, "/tasks");

    const board = await screen.findByTestId("task-board");
    // DONE has no rows in the fixture and still gets a lane: an empty column
    // is information, and a board whose columns come and go cannot be learnt.
    expect(within(board).getByLabelText("NEW")).toBeInTheDocument();
    expect(within(board).getByLabelText("IN_PROGRESS")).toBeInTheDocument();
    expect(within(board).getByLabelText("DONE")).toBeInTheDocument();
  });

  it("asks the server per lane, so each column has its own total", async () => {
    const asked: string[] = [];
    server.use(
      http.post("/platform/api/explorer/query", async ({ request }) => {
        const body = (await request.json()) as {
          resource_type?: string;
          filters?: Record<string, string>;
        };
        if (body.filters?.["status"]) asked.push(body.filters["status"]);
        return HttpResponse.json(entityResult(body));
      }),
    );

    render(<TasksBoardPage />, "/tasks");
    await screen.findByTestId("task-board");

    // One request per lane rather than one page of rows grouped in the browser.
    await waitFor(() => expect(asked).toEqual(expect.arrayContaining(["NEW", "DONE"])));
  });

  it("opens a card's record", async () => {
    const user = userEvent.setup();
    render(<TasksBoardPage />, "/tasks");

    const board = await screen.findByTestId("task-board");
    await user.click(
      await within(within(board).getByLabelText("IN_PROGRESS")).findByText(
        "Review customer migration",
      ),
    );

    expect(await screen.findByText("the record")).toBeInTheDocument();
  });
});

describe("projects — the portfolio table", () => {
  /** The row for a named project, so an assertion cannot match another one. */
  async function rowFor(name: string): Promise<HTMLElement> {
    const table = await screen.findByTestId("project-table");
    const cell = await within(table).findByText(name);
    const row = cell.closest("tr");
    if (!row) throw new Error(`${name} is not in a table row`);
    return row as HTMLElement;
  }

  it("puts delivered, schedule and budget on one row, so the gap can be read", async () => {
    render(<ProjectsPortfolioPage />, "/projects");

    // 62% delivered on 95% of a €400k budget. Neither number is a finding on
    // its own; side by side they are the reason the page exists.
    const row = await rowFor("Billing replatform");
    expect(within(row).getByText("62%")).toBeInTheDocument();
    expect(within(row).getByText("95%")).toBeInTheDocument();
  });

  it("names the finding rather than leaving three numbers to be compared", async () => {
    render(<ProjectsPortfolioPage />, "/projects");

    // Derived, never stored: "Behind" is what the gaps add up to, by the same
    // rule the delivery review uses (`entities/delivery.ts`) — and it names
    // *which* gap, because a column whose every row says one word carries no
    // information. Matched on the money, whose 33-point gap holds whatever day
    // the suite runs on; a schedule gap does not.
    const row = await rowFor("Billing replatform");
    expect(within(row).getByText(/^Behind · (money|both)$/)).toBeInTheDocument();
  });
});

describe("customers — the account grid", () => {
  it("reads an account as a card, not as seven columns", async () => {
    render(<CustomersPage />, "/customers");

    const grid = await screen.findByTestId("customer-grid");
    expect(await within(grid).findByText("Northwind Partners")).toBeInTheDocument();
    expect(within(grid).getByText("€480,000")).toBeInTheDocument();
    expect(within(grid).getByText("ops@northwind.example")).toBeInTheDocument();
  });
});

describe("orders — the ledger", () => {
  it("separates payment from fulfilment, because an order can be one and not the other", async () => {
    render(<OrdersLedgerPage />, "/orders");

    expect(await screen.findByRole("columnheader", { name: "Payment" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Fulfilment" })).toBeInTheDocument();
    expect(await screen.findByText("ORD-00311")).toBeInTheDocument();
  });

  it("totals the filtered set from the server, not the page it drew", async () => {
    render(<OrdersLedgerPage />, "/orders");

    await screen.findByText("ORD-00311");
    // The row on screen is €18,400; the total is the server's €1,250,000.
    expect(await screen.findByText("€1,250,000")).toBeInTheDocument();
    expect(screen.getByText(/the server's, not this page's/)).toBeInTheDocument();
  });
});

describe("tickets — the triage queue", () => {
  it("opens the first ticket beside the queue rather than making you navigate", async () => {
    render(<TicketsQueuePage />, "/tickets");

    const queue = await screen.findByTestId("ticket-queue");
    expect(
      await within(queue).findByText("Login fails after password reset"),
    ).toBeInTheDocument();
    // §63: the detail opens beside the queue rather than replacing the page.
    expect(within(queue).getByText("Invoice shows the wrong VAT")).toBeInTheDocument();
  });

  it("keeps the open ticket in the URL so it can be pasted", async () => {
    const user = userEvent.setup();
    render(<TicketsQueuePage />, "/tickets");

    const queue = await screen.findByTestId("ticket-queue");
    await user.click(await within(queue).findByText("Invoice shows the wrong VAT"));

    await waitFor(() =>
      expect(
        within(queue).getByText("Invoice shows the wrong VAT").closest("button"),
      ).toHaveAttribute("aria-current", "true"),
    );
  });

  it("gives SLA a control of its own, because it is why the page is open", async () => {
    const user = userEvent.setup();
    const asked: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/explorer/query", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        asked.push(body);
        return HttpResponse.json(entityResult(body));
      }),
    );

    render(<TicketsQueuePage />, "/tickets");
    await screen.findByTestId("ticket-queue");
    await user.click(await screen.findByText("Breached", { selector: ".ant-segmented-item-label" }));

    await waitFor(() =>
      expect(asked.at(-1)?.["filters"]).toEqual({ sla_breached: "true" }),
    );
  });
});

describe("devices — the fleet monitor", () => {
  it("draws two health signals per unit as bars, because a wall is scanned", async () => {
    render(<DevicesFleetPage />, "/devices");

    const fleet = await screen.findByTestId("device-fleet");
    expect(await within(fleet).findByText("Gateway Berlin 04")).toBeInTheDocument();
    expect(fleet.querySelectorAll(".nu-gauge").length).toBe(2);
    expect(within(fleet).getByText("18")).toBeInTheDocument();
    expect(within(fleet).getByText("71")).toBeInTheDocument();
  });

  it("says how stale a reading is, which is a different problem from being unwell", async () => {
    render(<DevicesFleetPage />, "/devices");

    const fleet = await screen.findByTestId("device-fleet");
    expect(await within(fleet).findByText(/silent|quiet|reporting/)).toBeInTheDocument();
  });
});

describe("what every entity page keeps in common", () => {
  it("shows the dataset's declared metrics over the rows in view", async () => {
    render(<DevicesFleetPage />, "/devices");

    const metrics = await screen.findByTestId("entity-metrics");
    // Formatted by the declaration: currency, percent and plain counts each
    // read the way the server said they should.
    expect(within(metrics).getByText("€1.3M")).toBeInTheDocument();
    expect(within(metrics).getByText("12.5")).toBeInTheDocument();
  });

  it.each([
    ["tasks", <TasksBoardPage />, "/tasks", "New task"],
    ["projects", <ProjectsPortfolioPage />, "/projects", "New project"],
    ["customers", <CustomersPage />, "/customers", "New customer"],
    ["orders", <OrdersLedgerPage />, "/orders", "New order"],
    ["tickets", <TicketsQueuePage />, "/tickets", "New ticket"],
    ["devices", <DevicesFleetPage />, "/devices", "New device"],
  ])("gives %s create, edit and delete, not only a list (§9)", async (_name, page, route, label) => {
    const user = userEvent.setup();
    render(page, route);

    // Create, named after the entity rather than "New record".
    expect(await screen.findByRole("button", { name: new RegExp(label) })).toBeEnabled();

    // And per record, edit and delete — from the same declaration, so a
    // dataset cannot be editable on one page and read-only on another.
    const actions = await screen.findAllByRole("button", { name: /^Actions for / });
    await user.click(actions[0]!);
    // Matched loosely: an AntD menu icon carries its own aria-label, so the
    // accessible name of the item is "edit Edit".
    expect(await screen.findByRole("menuitem", { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Delete/ })).toBeInTheDocument();
    // Longer than the default: the triage queue renders a list *and* opens a
    // record, and this case runs six whole pages.
  }, 15_000);

  it("says which permission is missing rather than drawing an empty page", async () => {
    server.use(
      http.post("/platform/api/explorer/query", () =>
        HttpResponse.json(
          {
            error: "forbidden",
            message: "refused",
            details: { missing: ["records.view"], missing_labels: ["View records"] },
          },
          { status: 403 },
        ),
      ),
    );

    render(<OrdersLedgerPage />, "/orders");

    expect(
      await screen.findByText("Your role does not include this dataset"),
    ).toBeInTheDocument();
  });
});
