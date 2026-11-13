import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import SlaPoliciesPage from "@/pages/decisions/SlaPoliciesPage";
import { grantDecisions } from "@/test/decisions";
import { decisionCalls, resetDecisions } from "@/test/handlers/decisions";
import { renderWithProviders } from "@/test/render";

function render(route = "/admin/sla") {
  return renderWithProviders(<Routes><Route path="/admin/sla" element={<SlaPoliciesPage />} /></Routes>, { route });
}

beforeEach(() => {
  resetDecisions();
  grantDecisions();
});

describe("SlaPoliciesPage", () => {
  it("lists policies in order with conditions, targets and escalations", async () => {
    render();
    const cards = await screen.findAllByTestId("sla-policy");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent("Strategic accounts");
    expect(cards[0]).toHaveTextContent("Segment: Strategic");
    expect(cards[0]).toHaveTextContent("Customer: Acme");
    expect(cards[0]).toHaveTextContent("Resolve 4h");
    expect(cards[0]).toHaveTextContent("150% → Raise priority");
    expect(cards[1]).toHaveTextContent("Every ticket");
    expect(screen.getByText(/52 open tickets covered · 3 breached/)).toBeInTheDocument();
  });

  it("reorders, toggles and applies", async () => {
    render();
    const cards = await screen.findAllByTestId("sla-policy");
    await userEvent.click(within(cards[1]!).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "order")?.body).toEqual({ ids: ["pol-2", "pol-1"] }));
    await userEvent.click(within((await screen.findAllByTestId("sla-policy"))[0]!).getByRole("switch"));
    await waitFor(() => expect(decisionCalls.some((c) => c.method === "PUT" && c.path.startsWith("policies/"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: /Apply now/ }));
    expect(await screen.findByText(/600 tickets recomputed, 3 escalations fired/)).toBeInTheDocument();
  });

  it("edits a policy in a drawer and saves targets in hours as minutes", async () => {
    render("/admin/sla?policy=pol-1");
    const drawer = await screen.findByTestId("sla-drawer");
    const field = within(drawer).getByLabelText("CRITICAL resolution hours");
    await waitFor(() => expect(field).toHaveDisplayValue("4.0"));
    await userEvent.clear(field);
    await userEvent.type(field, "2");
    await userEvent.click(within(drawer).getByRole("button", { name: /Add a step/ }));
    await userEvent.click(within(drawer).getByTestId("sla-save"));
    await waitFor(() => {
      const call = decisionCalls.find((c) => c.path === "policies/pol-1");
      expect(call?.body).toMatchObject({ targets: { CRITICAL: { first_response: 15, resolution: 120 } } });
    });
  });

  it("creates a policy and removes one", async () => {
    render();
    await userEvent.click(await screen.findByTestId("sla-new"));
    const drawer = await screen.findByTestId("sla-drawer");
    await userEvent.type(within(drawer).getByLabelText("Name"), "Bugs first");
    await userEvent.click(within(drawer).getByTestId("sla-save"));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "policies")?.body).toMatchObject({ name: "Bugs first" }));

    await userEvent.click((await screen.findAllByTestId("sla-edit"))[1]!);
    const editing = await screen.findByTestId("sla-drawer");
    await userEvent.click(within(editing).getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));
    await waitFor(() => expect(decisionCalls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("shows and edits business calendars", async () => {
    render("/admin/sla?tab=calendars");
    const cal = await screen.findByTestId("sla-calendar");
    expect(cal).toHaveTextContent("Europe/Berlin · 40 working hours a week · 1 holidays");
    await userEvent.click(within(cal).getByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByLabelText("sat open"));
    await userEvent.click(within(dialog).getByRole("button", { name: /Add a holiday/ }));
    await userEvent.click(within(dialog).getAllByRole("button", { name: "Remove holiday" })[0]!);
    await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => {
      const call = decisionCalls.find((c) => c.path === "calendars/cal-1");
      expect((call?.body as { hours: Record<string, string[][]> }).hours["sat"]).toEqual([["09:00", "17:00"]]);
    });
    await userEvent.click(screen.getByTestId("sla-new"));
    const fresh = await screen.findByRole("dialog");
    await userEvent.type(within(fresh).getByLabelText("Calendar name"), "Night desk");
    await userEvent.click(within(fresh).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "calendars")?.body).toMatchObject({ name: "Night desk" }));
  });
});
