import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TimePage from "@/pages/decisions/TimePage";
import { grantDecisions } from "@/test/decisions";
import { decisionCalls, resetDecisions } from "@/test/handlers/decisions";
import { renderWithProviders } from "@/test/render";

function render(route = "/time") {
  return renderWithProviders(
    <Routes>
      <Route path="/time" element={<TimePage />} />
      <Route path="*" element={<span>elsewhere</span>} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  resetDecisions();
  grantDecisions();
});

describe("TimePage — the week", () => {
  it("draws the grid with totals and saves a typed cell", async () => {
    render();
    const grid = await screen.findByTestId("week-grid");
    expect(within(grid).getByText("TSK-00001 · Ship the thing")).toBeInTheDocument();
    expect(screen.getByTestId("week-total")).toHaveTextContent("4h 15m");
    expect(screen.getByTestId("week-status")).toHaveTextContent("Draft");

    const cell = within(grid).getByLabelText(/TIC-00001 · Login fails on Wednesday/);
    await userEvent.clear(cell);
    await userEvent.type(cell, "1:30{Enter}");
    await waitFor(() => expect(decisionCalls.some((c) => c.path === "cell" && (c.body as { minutes: number }).minutes === 90)).toBe(true));
  });

  it("puts a nonsense cell back, and reports a refused one", async () => {
    render();
    const grid = await screen.findByTestId("week-grid");
    const cell = within(grid).getByLabelText(/TIC-00001 · Login fails on Thursday/);
    await userEvent.type(cell, "lots");
    fireEvent.blur(cell);
    expect(cell).toHaveValue("");
    await userEvent.type(cell, "999m");
    fireEvent.keyDown(cell, { key: "Escape" });
    await userEvent.clear(cell);
    await userEvent.type(cell, "16:39");
    fireEvent.blur(cell);
    expect(await screen.findByText(/Too low/)).toBeInTheDocument();
  });

  it("submits the week, which then locks", async () => {
    render();
    await userEvent.click(await screen.findByTestId("week-submit"));
    await userEvent.type(await screen.findByPlaceholderText(/note for your approver/), "Busy one");
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Submit week" }));
    expect(await screen.findByTestId("week-locked")).toHaveTextContent(/locked until/);
    expect(decisionCalls.find((c) => c.path === "submit")?.body).toEqual({ week: expect.any(String) as string, note: "Busy one" });
    expect(screen.getByTestId("week-submit")).toBeDisabled();
  });

  it("logs time by hand, with a duration", async () => {
    render();
    await userEvent.click(await screen.findByRole("button", { name: /Log time/ }));
    const modal = await screen.findByTestId("time-entry-modal");
    await userEvent.click(within(modal).getByRole("combobox", { name: "Work item" }));
    await userEvent.click(await screen.findByText("TSK-00001 · Ship the thing", { selector: ".ant-select-item-option-content" }));
    await userEvent.type(within(modal).getByRole("textbox", { name: "Duration" }), "1h 15m");
    await userEvent.type(within(modal).getByPlaceholderText("What you did"), "Docs");
    await userEvent.click(within(modal).getByRole("button", { name: "Log time" }));
    await waitFor(() => expect(decisionCalls.find((c) => c.path === "entries")?.body).toMatchObject({ minutes: 75, note: "Docs" }));
  });

  it("refuses a duration it cannot read", async () => {
    render();
    await userEvent.click(await screen.findByRole("button", { name: /Log time/ }));
    const modal = await screen.findByTestId("time-entry-modal");
    await userEvent.click(within(modal).getByRole("combobox", { name: "Work item" }));
    await userEvent.click(await screen.findByText("TSK-00001 · Ship the thing", { selector: ".ant-select-item-option-content" }));
    await userEvent.type(within(modal).getByRole("textbox", { name: "Duration" }), "soon");
    await userEvent.click(within(modal).getByRole("button", { name: "Log time" }));
    expect(await screen.findByText(/Type a duration like/)).toBeInTheDocument();
  });

  it("edits and removes an entry of the week", async () => {
    render();
    const list = await screen.findByTestId("time-entries");
    await userEvent.click(within(list).getAllByRole("button", { name: /Actions for/ })[0]!);
    await userEvent.click(await screen.findByText("Edit"));
    const modal = await screen.findByTestId("time-entry-modal");
    expect(within(modal).getByText("Edit time entry")).toBeInTheDocument();
    await userEvent.click(within(modal).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(decisionCalls.some((c) => c.method === "PUT" && c.path === "entries/e1")).toBe(true));

    await userEvent.click(within(await screen.findByTestId("time-entries")).getAllByRole("button", { name: /Actions for/ })[1]!);
    const removes = await screen.findAllByText("Remove");
    await userEvent.click(removes[removes.length - 1]!);
    await waitFor(() => expect(decisionCalls.some((c) => c.method === "DELETE")).toBe(true));
  });

  it("adds a row for a work item not yet in the week", async () => {
    render();
    await userEvent.click(await screen.findByRole("button", { name: /Add a row/ }));
    await userEvent.click(screen.getByRole("combobox", { name: "Work item" }));
    await userEvent.click(await screen.findByText("Ticket · TIC-00001 · Login fails"));
    expect(await screen.findByTestId("week-grid")).toBeInTheDocument();
  });

  it("walks to the previous and next week", async () => {
    render();
    await screen.findByTestId("week-grid");
    await userEvent.click(screen.getByRole("button", { name: "Previous week" }));
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(screen.getByTestId("week-label")).toBeInTheDocument();
  });

  it("shows a day list on a phone", async () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(390);
    render();
    expect(await screen.findByTestId("week-days")).toHaveTextContent("Monday 9 Nov");
    vi.restoreAllMocks();
  });
});

describe("TimePage — the other tabs", () => {
  it("lists entries with filters", async () => {
    render("/time?tab=entries");
    expect(await screen.findByText(/in 3 entries/)).toBeInTheDocument();
    await userEvent.click(screen.getByText("This week"));
    await userEvent.click(screen.getByRole("combobox", { name: "Billable" }));
    await userEvent.click(await screen.findByText("Non-billable", { selector: ".ant-select-item-option-content" }));
    expect(await screen.findByText(/in 1 entries/)).toBeInTheDocument();
  });

  it("shows the team's weeks to an approver", async () => {
    render("/time?tab=team");
    const team = await screen.findByTestId("time-team");
    expect(within(team).getByText("Otto Operator")).toBeInTheDocument();
    expect(within(team).getByRole("button", { name: "Review" })).toBeInTheDocument();
    await userEvent.click(within(team).getByText("Ana Analyst"));
    expect(await screen.findByTestId("week-grid")).toBeInTheDocument();
  });

  it("reports and exports", async () => {
    render("/time?tab=reports&by=person");
    const report = await screen.findByTestId("time-report");
    expect(within(report).getByText("Atlas migration")).toBeInTheDocument();
    await userEvent.click(screen.getByText("Customer"));
    await userEvent.hover(screen.getByTestId("time-export"));
    await userEvent.click(await screen.findByText("CSV"));
    await waitFor(() => expect(decisionCalls.some((c) => c.path === "export" && c.body === "csv")).toBe(true));
  });

  it("switches tabs", async () => {
    render();
    await userEvent.click(await screen.findByTestId("time-tab-entries"));
    expect(await screen.findByText(/entries$/)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("time-tab-week"));
    expect(await screen.findByTestId("week-grid")).toBeInTheDocument();
  });
});
