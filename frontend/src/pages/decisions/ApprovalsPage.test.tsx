import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import ApprovalsPage from "@/pages/decisions/ApprovalsPage";
import { grantDecisions } from "@/test/decisions";
import { decisionCalls, resetDecisions } from "@/test/handlers/decisions";
import { renderWithProviders } from "@/test/render";

function render(route = "/approvals") {
  return renderWithProviders(
    <Routes><Route path="/approvals" element={<ApprovalsPage />} /></Routes>,
    { route },
  );
}

beforeEach(() => {
  resetDecisions();
  grantDecisions();
});

describe("ApprovalsPage", () => {
  it("lists what needs a decision with its age and approves one at a press", async () => {
    render();
    const list = await screen.findByTestId("approvals-list");
    expect(within(list).getAllByTestId("approval-row")).toHaveLength(3);
    expect(list).toHaveTextContent("Overdue 30h");
    expect(list).toHaveTextContent("Due in 2h");
    expect(screen.getByText(/3 waiting on you · 1 overdue/)).toBeInTheDocument();
    await userEvent.click(within(list).getAllByTestId("approval-quick-approve")[0]!);
    await waitFor(() => expect(decisionCalls.some((c) => c.path === "decision/1")).toBe(true));
  });

  it("rejects only with a reason", async () => {
    render();
    const list = await screen.findByTestId("approvals-list");
    await userEvent.click(within(list).getAllByRole("button", { name: "Reject" })[0]!);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Reject" })).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText("Comment"), "Not your area");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "decision/1")?.body).toEqual({ decision: "reject", comment: "Not your area" }));
  });

  it("decides several at once and says which could not be", async () => {
    render();
    await screen.findByTestId("approvals-list");
    await userEvent.click(screen.getByText("Select all on this page"));
    expect(screen.getByTestId("approvals-bulk")).toHaveTextContent("3 selected");
    await userEvent.click(screen.getByTestId("approvals-bulk-approve"));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "bulk")?.body).toMatchObject({ decision: "approve", ids: ["1", "2", "3"] }));
    expect(await screen.findByText(/2 decided, 1 could not be/)).toBeInTheDocument();
  });

  it("opens a request in a drawer with its details and history, and decides it there", async () => {
    render("/approvals?open=2");
    const drawer = await screen.findByTestId("approval-drawer");
    expect(await within(drawer).findByTestId("approval-title")).toHaveTextContent("Timesheet");
    expect(within(drawer).getByLabelText("Hours per day")).toBeInTheDocument();
    expect(within(drawer).getByTestId("approval-history")).toHaveTextContent("submitted");
    expect(within(drawer).getByTestId("approval-reject")).toBeDisabled();
    await userEvent.type(within(drawer).getByLabelText("Decision comment"), "Split it");
    await userEvent.click(within(drawer).getByTestId("approval-reject"));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "decision/2")?.body).toEqual({ decision: "reject", comment: "Split it" }));
  });

  it("shows a held change and approves it from the drawer", async () => {
    render("/approvals?open=3");
    expect(await screen.findByTestId("approval-changes")).toHaveTextContent("1000 → 60000");
    await userEvent.click(screen.getByTestId("approval-approve"));
    await waitFor(() => expect(decisionCalls.some((c) => c.path === "decision/3")).toBe(true));
  });

  it("lets a requester withdraw their own request", async () => {
    render("/approvals?scope=mine&open=4");
    await userEvent.click(await screen.findByRole("button", { name: "Withdraw request" }));
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));
    await waitFor(() => expect(decisionCalls.some((c) => c.path === "withdraw/4")).toBe(true));
  });

  it("filters by kind, requester, age and text", async () => {
    render();
    await screen.findByTestId("approvals-list");
    await userEvent.click(screen.getByRole("combobox", { name: "Kind" }));
    await userEvent.click(await screen.findByText("Timesheets (1)"));
    await waitFor(() => expect(screen.getAllByTestId("approval-row")).toHaveLength(1));
    await userEvent.click(screen.getByText("Overdue"));
    await userEvent.type(screen.getByLabelText("Search requests"), "week");
    await userEvent.click(screen.getByRole("combobox", { name: "Requester" }));
    await userEvent.click(await screen.findByText("Uma User (3)"));
    expect(screen.getByRole("combobox", { name: "Requester" })).toBeInTheDocument();
  });

  it("switches to decided and my requests", async () => {
    render();
    await userEvent.click(await screen.findByTestId("approvals-scope-mine"));
    expect(await screen.findByText("Mine")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("approvals-scope-history"));
    expect(await screen.findByText(/No requests match/)).toBeInTheDocument();
  });

  it("manages the rules that hold edits back", async () => {
    render("/approvals?scope=rules");
    const rules = await screen.findByTestId("approval-rules");
    expect(rules).toHaveTextContent("When a ticket's priority becomes CRITICAL");
    await userEvent.click(within(rules).getByRole("switch"));
    await waitFor(() => expect(decisionCalls.some((c) => c.path === "rules/r1")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: /New rule/ }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Name"), "Big orders");
    await userEvent.click(within(dialog).getByLabelText("Dataset"));
    await userEvent.click(await screen.findByText("Orders", { selector: ".ant-select-item-option-content" }));
    await userEvent.click(within(dialog).getByLabelText("Field"));
    await userEvent.click(await screen.findByText("Total", { selector: ".ant-select-item-option-content" }));
    await userEvent.click(within(dialog).getByLabelText(/Hold the edit/));
    await userEvent.click(await screen.findByText("…is greater than"));
    await userEvent.type(within(dialog).getByLabelText("Value"), "50000");
    await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "rules")?.body).toMatchObject({ name: "Big orders", resource_type: "order", field: "total", operator: "GT", value: 50000 }));

    await userEvent.click(within(await screen.findByTestId("approval-rules")).getAllByRole("button", { name: "Remove" })[0]!);
    await userEvent.click(await screen.findByRole("button", { name: "OK" }));
    await waitFor(() => expect(decisionCalls.some((c) => c.method === "DELETE")).toBe(true));
  });
});
