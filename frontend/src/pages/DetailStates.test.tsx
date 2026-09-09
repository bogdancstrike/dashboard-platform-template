import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, delay, http } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import EntityDetailPage from "@/pages/EntityDetailPage";
import ProjectDeliveryPage from "@/pages/entities/ProjectDeliveryPage";
import TaskDetailPage from "@/pages/entities/TaskDetailPage";
import TicketConsolePage from "@/pages/entities/TicketConsolePage";
import { CommandProvider } from "@/commands/CommandContext";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The states a detail page has, on every detail page there is (§34).
 *
 * The lists got this sweep first (`entities/EntityStates.test.tsx`) and it
 * found four wrong out of six, for the reason a sweep exists: each page had
 * been tested by whoever wrote it, on the state they happened to think about.
 * A record page has four such states — it is arriving, it is not there, it is
 * not yours, and something broke — and three of the four are the ones nobody
 * demonstrates.
 *
 * The four pages here are two implementations: the three work pages share
 * `useRecordPage`, and `EntityDetailPage` serves the datasets that have no
 * bespoke page. Both are asserted, because "the hook is tested" is not the
 * same claim as "the page shows it".
 *
 * What must hold everywhere:
 *
 * * a **skeleton** while it loads, never a spinner and never an empty layout
 *   dressed as a record;
 * * **not found** and **not permitted** say different things, because they
 *   lead somewhere different;
 * * every failure carries the **correlation id**, which is the only thing a
 *   reader can hand to somebody who can help;
 * * a **retry** appears only where trying again could work — the rule the
 *   error pages already hold to (`PROBLEMS.not_found.retryable === false`) —
 *   and where it cannot, the way out is the list.
 */

const PAGES = [
  {
    name: "the task work page",
    path: "/tasks/:id",
    route: "/tasks/task-1",
    list: "/tasks",
    element: <TaskDetailPage />,
    missing: "Task not found",
  },
  {
    name: "the delivery review",
    path: "/projects/:id",
    route: "/projects/project-1",
    list: "/projects",
    element: <ProjectDeliveryPage />,
    missing: "Project not found",
  },
  {
    name: "the support console",
    path: "/tickets/:id",
    route: "/tickets/ticket-1",
    list: "/tickets",
    element: <TicketConsolePage />,
    missing: "Ticket not found",
  },
  {
    name: "the generic record page",
    path: "/customers/:id",
    route: "/customers/customer-1",
    list: "/customers",
    element: <EntityDetailPage resourceKey="customer" />,
    missing: "Record not found",
  },
] as const;

function render(page: React.ReactNode, path: string, route: string, list: string) {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path={path} element={page} />
        <Route path={list} element={<div>the list</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

/** Answer the record read with one failure, carrying an id to quote. */
function readFails(status: number, details: Record<string, unknown> = {}) {
  server.use(
    http.get("/platform/api/records/:type/:id", () =>
      HttpResponse.json(
        { error: "record_error", message: "The record could not be read.", details },
        { status, headers: { "X-Correlation-ID": "detail-trace" } },
      ),
    ),
  );
}

describe.each(PAGES)("$name", ({ path, route, list, element, missing }) => {
  it("draws a skeleton while the record is arriving", async () => {
    server.use(
      http.get("/platform/api/records/:type/:id", async () => {
        await delay(120);
        return HttpResponse.json({ error: "slow" }, { status: 500 });
      }),
    );
    const view = render(element, path, route, list);

    await waitFor(() =>
      expect(view.container.querySelector(".ant-skeleton")).toBeInTheDocument(),
    );
  });

  it("says the record is not there, and offers the way back rather than a retry", async () => {
    readFails(404);
    render(element, path, route, list);

    const failure = await screen.findByTestId("failure-alert");
    expect(failure).toHaveAttribute("data-failure", "not_found");
    expect(await screen.findByText(missing)).toBeInTheDocument();
    // What to do about it, which a status code does not say.
    expect(failure).toHaveTextContent(/deleted, or the link may be wrong/);
    expect(within(failure).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(within(failure).getByRole("button", { name: /back/i })).toBeInTheDocument();
  });

  it("names the permission it lacks, in the product's own words", async () => {
    readFails(403, { missing: ["records.view"] });
    render(element, path, route, list);

    const failure = await screen.findByTestId("failure-alert");
    expect(failure).toHaveAttribute("data-failure", "forbidden");
    // The same sentence a disabled control uses, so the two read as one rule.
    expect(failure).toHaveTextContent("Your role does not include records.view");
    expect(within(failure).queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("quotes the correlation id on a fault, and retries it", async () => {
    readFails(500);
    render(element, path, route, list);

    const failure = await screen.findByTestId("failure-alert");
    expect(failure).toHaveAttribute("data-failure", "failed");
    expect(failure).toHaveTextContent("detail-trace");
    expect(failure).toHaveTextContent("The record could not be read.");

    const user = userEvent.setup();
    let reads = 0;
    server.use(
      http.get("/platform/api/records/:type/:id", () => {
        reads += 1;
        return HttpResponse.json(
          { error: "again", message: "Still broken." },
          { status: 500, headers: { "X-Correlation-ID": "detail-trace" } },
        );
      }),
    );
    await user.click(within(failure).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reads).toBe(1));
  });
});
