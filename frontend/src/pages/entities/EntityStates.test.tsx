import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
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
 * The three states a list spends more time in than anyone expects (§34).
 *
 * Loading, nothing-yet and nothing-matched, on all six lists rather than on
 * whichever page a test happened to cover. The tracker asked for exactly this
 * and nothing asserted it — and two of the six were wrong: the account grid
 * and the fleet answered "no accounts match these filters" **with no filters
 * set**, which tells a reader their filter is bad when the dataset is simply
 * empty, and offers no way to clear filters that do not exist.
 *
 * The distinction is the whole point. "Nothing here yet" wants the action that
 * creates the first record; "nothing matched" wants the filters cleared. One
 * shrug for both leaves the reader unsure which of the two they are looking at.
 *
 * The two failure states are here for the same reason: a refusal and a fault
 * were demonstrated on *one* of the six lists each, and a list that draws an
 * empty table over a 403 tells the reader the dataset is empty.
 */

const PAGES = [
  { name: "the board", path: "/tasks", element: <TasksBoardPage /> },
  { name: "the portfolio", path: "/projects", element: <ProjectsPortfolioPage /> },
  { name: "the account grid", path: "/customers", element: <CustomersPage /> },
  { name: "the ledger", path: "/orders", element: <OrdersLedgerPage /> },
  { name: "the queue", path: "/tickets", element: <TicketsQueuePage /> },
  { name: "the fleet", path: "/devices", element: <DevicesFleetPage /> },
] as const;

function render(page: React.ReactNode, route: string) {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path={new URL(route, "http://x").pathname} element={page} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

/** Answer every list query with one failure, carrying an id to quote. */
function listFails(status: number, details: Record<string, unknown> = {}) {
  server.use(
    http.post("/platform/api/explorer/query", () =>
      HttpResponse.json(
        { error: "list_error", message: "Those rows could not be read.", details },
        { status, headers: { "X-Correlation-ID": "list-trace" } },
      ),
    ),
  );
}

/** Answer every list query with no rows at all. */
function emptyDataset() {
  server.use(
    http.post("/platform/api/explorer/query", async ({ request }) => {
      const body = (await request.json()) as { resource_type?: string };
      return HttpResponse.json({ ...entityResult(body), items: [], total: 0 });
    }),
  );
}

describe.each(PAGES)("$name", ({ path, element }) => {
  it("draws a skeleton in the final layout while it waits", async () => {
    server.use(
      http.post("/platform/api/explorer/query", async ({ request }) => {
        await delay(80);
        const body = (await request.json()) as { resource_type?: string };
        return HttpResponse.json(entityResult(body));
      }),
    );
    const view = render(element, path);

    // A skeleton and never a centred spinner: a spinner tells a reader the
    // page is busy, and a skeleton tells them what is about to be there.
    await waitFor(() =>
      expect(view.container.querySelector(".ant-skeleton")).toBeInTheDocument(),
    );
  });

  it("says nothing is here *yet*, and offers what makes the first one", async () => {
    emptyDataset();
    render(element, path);

    const empty = await screen.findByTestId("empty-state");
    // No filters are set, so this is an empty dataset rather than a bad
    // question — and it must not claim otherwise.
    expect(empty).not.toHaveTextContent(/filter/i);
    expect(within(empty).getByRole("button")).toBeInTheDocument();
  });

  it("says nothing *matched*, and clears the filters in one click", async () => {
    emptyDataset();
    render(element, `${path}?f.status=NOTHING`);

    const empty = await screen.findByTestId("empty-state");
    expect(empty).toHaveTextContent(/match/i);
    // One click, on the thing that caused it.
    expect(within(empty).getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  it("names the permission it lacks rather than drawing an empty list", async () => {
    listFails(403, { missing: ["records.view"] });
    render(element, path);

    const failure = await screen.findByTestId("failure-alert");
    expect(failure).toHaveAttribute("data-failure", "forbidden");
    expect(failure).toHaveTextContent("Your role does not include this dataset");
    // The same sentence the disabled controls use, and no retry — a refusal
    // does not become permission on a second press.
    expect(failure).toHaveTextContent("Your role does not include records.view");
    expect(within(failure).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    // And never a shrug that reads as "there is nothing here".
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("says a fault is a fault, with the id to quote, and retries it", async () => {
    listFails(500);
    const user = userEvent.setup();
    render(element, path);

    const failure = await screen.findByTestId("failure-alert");
    expect(failure).toHaveAttribute("data-failure", "failed");
    expect(failure).toHaveTextContent("list-trace");
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();

    let reads = 0;
    server.use(
      http.post("/platform/api/explorer/query", () => {
        reads += 1;
        return HttpResponse.json({ error: "again", message: "Still broken." }, { status: 500 });
      }),
    );
    await user.click(within(failure).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reads).toBeGreaterThan(0));
  });
});
