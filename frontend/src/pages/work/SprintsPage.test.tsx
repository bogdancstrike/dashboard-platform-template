import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import { planningState, resetPlanning } from "@/test/handlers/planning";
import { pointAt } from "@/test/pointerShim";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import SprintsPage from "./SprintsPage";

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.search}</span>;
}

function open(route = "/sprints?project=prj-1") {
  return renderWithProviders(
    <>
      <Where />
      <Routes>
        <Route path="/sprints" element={<SprintsPage />} />
        <Route path="/tasks/:id" element={<div>the task</div>} />
      </Routes>
    </>,
    { route },
  );
}

describe("/sprints", () => {
  beforeEach(() => resetPlanning());

  it("lists the open sprints with their capacity, and the backlog", async () => {
    open("/sprints");
    const active = await screen.findByTestId("sprint-PRJ-0001 Sprint 5");
    expect(within(active).getByText("Running")).toBeInTheDocument();
    expect(within(active).getByText("Pay an invoice online")).toBeInTheDocument();
    expect(within(active).getByLabelText("8 of 20 capacity points")).toBeInTheDocument();
    expect(screen.getByTestId("sprint-PRJ-0001 Sprint 6")).toHaveTextContent("Drag work here from the backlog");
    const backlog = screen.getByTestId("backlog");
    expect(within(backlog).getByText("Export the ledger")).toBeInTheDocument();
    expect(within(backlog).getByLabelText("not estimated")).toBeInTheDocument();
  });

  it("plans by keyboard: a backlog item carried into the next sprint", async () => {
    open();
    const item = await screen.findByTestId("plan-item-TSK-00103");
    item.focus();
    fireEvent.keyDown(item, { key: " " });
    fireEvent.keyDown(item, { key: "ArrowLeft" });
    fireEvent.keyDown(item, { key: " " });
    await waitFor(() =>
      expect(planningState.calls.find((call) => call.url.endsWith("/backlog/place"))?.body).toMatchObject({
        task_id: "c-3",
        sprint_id: "sp-next",
        after_id: null,
        before_id: null,
      }),
    );
    expect(await within(screen.getByTestId("sprint-PRJ-0001 Sprint 6")).findByText("Export the ledger")).toBeInTheDocument();
  });

  it("plans by pointer: a sprint item dragged back to the backlog, and a refusal snaps back", async () => {
    open();
    const item = await screen.findByTestId("plan-item-TSK-00102");
    const backlogList = screen.getByTestId("backlog").querySelector("[data-drop-list]");
    const restore = pointAt(() => backlogList);
    fireEvent.pointerDown(item, { button: 0, clientX: 10, clientY: 10, pointerType: "mouse" });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 10 });
    restore();
    await waitFor(() =>
      expect(planningState.calls.find((call) => call.url.endsWith("/backlog/place"))?.body).toMatchObject({ task_id: "c-2", sprint_id: null }),
    );

    server.use(
      http.post("/platform/api/work/backlog/place", () =>
        HttpResponse.json({ error: "conflict", message: "That sprint is finished." }, { status: 409 }),
      ),
    );
    const again = await screen.findByTestId("plan-item-TSK-00104");
    again.focus();
    fireEvent.keyDown(again, { key: " " });
    fireEvent.keyDown(again, { key: "ArrowLeft" });
    fireEvent.keyDown(again, { key: "Enter" });
    expect(await screen.findByText("That sprint is finished.")).toBeInTheDocument();
  });

  it("plans, edits, deletes and starts sprints", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByTestId("sprint-PRJ-0001 Sprint 6");
    await user.click(screen.getByTestId("sprint-new"));
    const dialog = await screen.findByRole("dialog", { name: "Plan a sprint" });
    await user.type(within(dialog).getByLabelText("Sprint name"), "Sprint 7");
    await user.type(within(dialog).getByLabelText("Sprint goal"), "Partners");
    await user.click(within(dialog).getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Sprint 7 planned")).toBeInTheDocument();
    expect(planningState.calls.at(-1)!.body).toMatchObject({ project_id: "prj-1", name: "Sprint 7", goal: "Partners" });

    await user.click(screen.getByRole("button", { name: "More for PRJ-0001 Sprint 6" }));
    await user.click(await screen.findByText("Edit"));
    const edit = await screen.findByRole("dialog", { name: "Edit PRJ-0001 Sprint 6" });
    await user.clear(within(edit).getByLabelText("Capacity"));
    await user.type(within(edit).getByLabelText("Capacity"), "25");
    await user.click(within(edit).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Sprint saved")).toBeInTheDocument();

    // Starting while another runs is refused, and the reason is shown.
    expect(screen.getByTestId("sprint-start-PRJ-0001 Sprint 6")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "More for PRJ-0001 Sprint 6" }));
    await user.click(await screen.findByText("Delete"));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("PRJ-0001 Sprint 6 deleted")).toBeInTheDocument();
  });

  it("starts a planned sprint when none is running", async () => {
    const user = userEvent.setup();
    planningState.sprints = planningState.sprints.filter((sprint) => sprint.state !== "ACTIVE");
    open();
    await user.click(await screen.findByTestId("sprint-start-PRJ-0001 Sprint 6"));
    const dialog = await screen.findByRole("dialog", { name: "Start PRJ-0001 Sprint 6" });
    await user.click(within(dialog).getByRole("button", { name: "Start sprint" }));
    expect(await screen.findByText("PRJ-0001 Sprint 6 started")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("tab=board");
  });

  it("completes the running sprint, carrying work to the next one", async () => {
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByTestId("sprint-complete-PRJ-0001 Sprint 5"));
    const dialog = await screen.findByRole("dialog", { name: "Complete PRJ-0001 Sprint 5" });
    expect(within(dialog).getByText(/Move the 1 unfinished task to/)).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText("A new sprint"));
    await user.click(within(dialog).getByRole("button", { name: "Complete sprint" }));
    expect(await screen.findByText(/completed — 1 done, 1 carried over/)).toBeInTheDocument();
    expect(planningState.calls.at(-1)!.body).toEqual({ carry_over: "new" });
    expect(screen.getByTestId("where")).toHaveTextContent("tab=reports");
  });

  it("works the running sprint on a board", async () => {
    open("/sprints?project=prj-1&tab=board");
    expect(await screen.findByTestId("sprint-board")).toBeInTheDocument();
    expect(screen.getByTestId("sprint-kpis")).toHaveTextContent("Days left6");
    const card = await screen.findByTestId("sprint-card-TSK-00102");
    expect(card).toHaveTextContent("Waiting on the gateway");
    card.focus();
    fireEvent.keyDown(card, { key: " " });
    fireEvent.keyDown(card, { key: "ArrowRight" });
    fireEvent.keyDown(card, { key: " " });
    await waitFor(() => expect(screen.getByTestId("sprint-lane-BLOCKED")).toHaveTextContent("Card decline retry"));
    fireEvent.click(screen.getByTestId("sprint-card-TSK-00101"));
    expect(screen.getByText("the task")).toBeInTheDocument();
  });

  it("says when no sprint is running", async () => {
    const user = userEvent.setup();
    planningState.sprints = planningState.sprints.filter((sprint) => sprint.state !== "ACTIVE");
    open("/sprints?project=prj-1&tab=board");
    expect(await screen.findByText("No sprint is running")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Go to planning" }));
    expect(screen.getByTestId("where")).not.toHaveTextContent("tab=");
  });

  it("reports burndown, velocity and what a finished sprint did", async () => {
    const user = userEvent.setup();
    open("/sprints?project=prj-1&tab=reports");
    expect(await screen.findByTestId("burndown-chart")).toBeInTheDocument();
    expect(await screen.findByTestId("velocity-chart")).toBeInTheDocument();
    expect(screen.getByText("Average velocity").parentElement).toHaveTextContent("17");
    await user.click(screen.getByRole("combobox", { name: "Sprint" }));
    await user.click(await screen.findByText("PRJ-0001 Sprint 4"));
    const report = await screen.findByTestId("sprint-report");
    expect(report).toHaveTextContent("TSK-00091 → backlog");
    expect(report).toHaveTextContent("Nothing — the scope held");
  });

  it("has nothing to report before any sprint starts, and nothing planned says so", async () => {
    planningState.sprints = [];
    open("/sprints?project=prj-1&tab=reports");
    expect(await screen.findByText("No sprint has started yet")).toBeInTheDocument();
    open("/sprints?project=prj-1");
    expect(await screen.findByText("No sprint planned")).toBeInTheDocument();
  });
});
