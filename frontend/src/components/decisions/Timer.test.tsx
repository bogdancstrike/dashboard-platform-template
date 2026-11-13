import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { RecordTimeCard, RecordTimerButton } from "@/components/decisions/RecordTimer";
import { TimerPill } from "@/components/decisions/TimerPill";
import { TicketSlaCard } from "@/components/decisions/TicketSlaCard";
import { AskForAccess } from "@/components/decisions/AskForAccess";
import { grantDecisions, onlyPermissions } from "@/test/decisions";
import { decisionCalls, resetDecisions } from "@/test/handlers/decisions";
import { renderWithProviders } from "@/test/render";

beforeEach(() => {
  resetDecisions();
  grantDecisions();
});

describe("TimerPill", () => {
  it("starts a timer from the header and stops it with a note", async () => {
    renderWithProviders(<TimerPill />);
    const pill = await screen.findByTestId("timer-pill");
    expect(pill).toHaveAccessibleName("Start a timer");
    await userEvent.click(pill);
    const pop = await screen.findByTestId("timer-popover");
    expect(within(pop).getByText(/2h 15m logged today/)).toBeInTheDocument();
    await userEvent.click(within(pop).getByRole("combobox"));
    await userEvent.click(await screen.findByText("TSK-00001 · Ship the thing", { selector: ".ant-select-item-option-content" }));
    await userEvent.click(within(pop).getByTestId("timer-start"));
    expect(await screen.findByTestId("timer-clock")).toHaveTextContent(/0:0[01]:\d\d/);

    await userEvent.click(screen.getByTestId("timer-pill"));
    const running = await screen.findByTestId("timer-popover");
    await userEvent.type(within(running).getByLabelText("Note for this time"), "Pairing");
    await userEvent.click(within(running).getByLabelText("Billable"));
    await userEvent.click(within(running).getByTestId("timer-stop"));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "stop")?.body).toEqual({ note: "Pairing", billable: false }));
    expect(await screen.findByTestId("timer-pill")).toHaveAccessibleName("Start a timer");
  });

  it("is absent for somebody who does not track time", async () => {
    onlyPermissions("records.view");
    const { container } = renderWithProviders(<TimerPill />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector(".nx-td-pill")).toBeNull();
  });
});

describe("RecordTimer", () => {
  it("starts and stops the timer on this record, and logs time by hand", async () => {
    renderWithProviders(<><RecordTimerButton subjectType="task" subjectId="task-1" label="TSK-00001" /><RecordTimeCard subjectType="task" subjectId="task-1" /></>);
    const button = await screen.findByTestId("record-timer");
    await userEvent.click(button);
    await waitFor(() => expect(screen.getByTestId("record-timer")).toHaveTextContent(/Stop/));
    await userEvent.click(screen.getByTestId("record-timer"));
    await waitFor(() => expect(screen.getByTestId("record-timer")).toHaveTextContent("Start timer"));
    expect(await screen.findByTestId("record-time")).toHaveTextContent("5h");
    await userEvent.click(screen.getByTestId("record-log-time"));
    expect(await screen.findByTestId("time-entry-modal")).toBeInTheDocument();
  });
});

describe("TicketSlaCard", () => {
  it("says which policy applies and the time left in business hours", async () => {
    renderWithProviders(<TicketSlaCard ticketId="ticket-sla" />);
    expect(await screen.findByTestId("ticket-sla-policy")).toHaveTextContent("Strategic accounts");
    const card = screen.getByTestId("ticket-sla");
    expect(card).toHaveTextContent("1h 35m left");
    expect(card).toHaveTextContent("Met");
    expect(card).toHaveTextContent("61% of the target used");
    expect(card).toHaveTextContent("50% · notify assignee · done");
  });
});

describe("AskForAccess", () => {
  it("sends a request for the permission the page needed", async () => {
    renderWithProviders(<AskForAccess missing={["View audit logs"]} />);
    await userEvent.click(await screen.findByTestId("problem-ask-access"));
    await userEvent.type(await screen.findByLabelText("Reason"), "Incidents");
    await userEvent.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "access")?.body).toMatchObject({ permission: "audit.view", reason: "Incidents" }));
    expect(await screen.findByTestId("problem-access-sent")).toHaveTextContent("APR-00009");
  });

  it("offers nothing for a permission it cannot name", async () => {
    const { container } = renderWithProviders(<AskForAccess missing={["nonsense.code"]} />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector("[data-testid=problem-ask-access]")).toBeNull();
  });
});
