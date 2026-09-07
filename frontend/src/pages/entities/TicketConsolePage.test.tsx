import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import TicketConsolePage from "@/pages/entities/TicketConsolePage";
import { CommandProvider } from "@/commands/CommandContext";
import { resetComments, ticketRecord } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The ticket support console (§8, §36, §48).
 *
 * What is worth asserting is the ordering of the job: the clock is the first
 * thing on the screen, whether the SLA was missed is the server's answer and
 * not a subtraction done here, triage writes without a form, and the account's
 * history is the ticket list narrowed rather than a second list.
 */
function render(route = "/tickets/ticket-1") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tickets/:id" element={<TicketConsolePage />} />
        <Route path="/tickets" element={<div>the queue</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetComments());

function serveTicket(overrides: Record<string, unknown>, fields: Record<string, unknown> = {}) {
  server.use(
    http.get("/platform/api/records/ticket/:id", () =>
      HttpResponse.json({
        ...ticketRecord,
        ...overrides,
        fields: ticketRecord.fields.map((field) =>
          field.name in fields ? { ...field, value: fields[field.name] } : field,
        ),
      }),
    ),
  );
}

function capturePut(bodies: Record<string, unknown>[]) {
  server.use(
    http.put("/platform/api/records/:type/:id", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({ ...ticketRecord, ...body });
    }),
  );
}

describe("the ticket support console", () => {
  it("leads with the clock, because that is what decides what happens next", async () => {
    render();

    const sla = await screen.findByTestId("sla-standing");
    expect(within(sla).getByText("SLA breached")).toBeInTheDocument();
    expect(within(sla).getByText(/First answered after 45m/)).toBeInTheDocument();
    // A ticket that has come back twice is a different ticket from one that
    // has not, and the strip says so rather than burying it in a field list.
    expect(within(sla).getByText("Reopened 2 times")).toBeInTheDocument();
  });

  it("takes the breach from the server rather than deciding for itself", async () => {
    // Past its deadline, but the server has not called it a breach — a page
    // that recomputed the rule would contradict every report ever run.
    serveTicket({}, { sla_breached: false, due_at: "2027-01-01T09:00:00Z" });
    render();

    const sla = await screen.findByTestId("sla-standing");
    expect(within(sla).queryByText("SLA breached")).not.toBeInTheDocument();
    expect(within(sla).getByText(/^Due in /)).toBeInTheDocument();
  });

  it("does not congratulate a ticket that was resolved late", async () => {
    serveTicket({}, { resolved_at: "2026-09-05T10:00:00Z", resolution_minutes: 1560 });
    render();

    const sla = await screen.findByTestId("sla-standing");
    expect(within(sla).getByText("Resolved late")).toBeInTheDocument();
    expect(within(sla).getByText(/past the deadline it was given/)).toBeInTheDocument();
  });

  it("lays the handling out as a sequence, not four timestamps", async () => {
    render();

    // The four moments a support desk is measured on, in the order they
    // happen — and the deadline says what it *means* rather than repeating
    // the interval printed beside it.
    const response = await screen.findByTestId("ticket-response");
    for (const moment of ["Raised", "First answered", "Promised by", "Resolved"]) {
      expect(within(response).getByText(moment)).toBeInTheDocument();
    }
    expect(within(response).getByText("Missed, and still open")).toBeInTheDocument();
    expect(within(response).getByText("Still open")).toBeInTheDocument();
  });

  it("shows the filing in words, including the project nothing used to name", async () => {
    render();

    // "chat · data" in a subtitle is two words a reader has to guess at, and
    // `project_id` was declared and shown nowhere.
    // Read off the label cells themselves: "Project" also appears in the row's
    // *value* when a ticket is filed against none of them.
    const filing = await screen.findByTestId("ticket-filing");
    const labels = [...filing.querySelectorAll(".ant-descriptions-item-label")].map(
      (cell) => cell.textContent,
    );
    expect(labels).toEqual(["Category", "Channel", "Satisfaction", "Reopened", "Project", "Last changed"]);
  });

  it("re-triages without opening a form, with the version it read", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePut(bodies);

    render();
    const triage = await screen.findByTestId("ticket-triage");
    await user.click(within(triage).getByRole("combobox", { name: "Severity" }));
    await user.click(await screen.findByTitle("MAJOR"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      severity: "MAJOR",
      expected_updated_at: ticketRecord.updated_at,
    });
  });

  it("shows the account and what else it has raised, as a filtered list", async () => {
    render();

    const account = await screen.findByTestId("ticket-account");
    expect(await within(account).findByText("Northwind Partners")).toBeInTheDocument();
    // The ticket being read is not one of "their other tickets".
    expect(within(account).queryByText("Login fails after password reset")).not.toBeInTheDocument();
    expect(
      await within(account).findByRole("link", { name: "Invoice shows the wrong VAT" }),
    ).toBeInTheDocument();
  });

  it("says a ticket filed against nobody is filed against nobody", async () => {
    serveTicket({}, { customer_id: null });
    render();

    const account = await screen.findByTestId("ticket-account");
    expect(
      within(account).getByText("This ticket is not filed against a customer"),
    ).toBeInTheDocument();
  });

  it("puts the conversation on the page, not behind a tab", async () => {
    render();

    // Answering is the action, so the thread is on screen rather than one
    // click away (§36).
    expect(await screen.findByTestId("comment-thread")).toBeInTheDocument();
    expect(screen.getByText("What was reported")).toBeInTheDocument();
  });
});
