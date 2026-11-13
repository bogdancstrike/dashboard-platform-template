import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes, useLocation } from "react-router-dom";

import { ZOOMS } from "@/components/planning/gantt";
import { planningState, resetPlanning } from "@/test/handlers/planning";
import { pointAt } from "@/test/pointerShim";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import TimelinePage from "./TimelinePage";

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname + location.search}</span>;
}

function open(route = "/timeline?zoom=day") {
  return renderWithProviders(
    <>
      <Where />
      <Routes>
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/tasks/:id" element={<div>the task</div>} />
        <Route path="/sprints" element={<div>the sprints</div>} />
        <Route path="/tasks" element={<div>the board</div>} />
      </Routes>
    </>,
    { route },
  );
}

function drag(target: Element, dx: number) {
  fireEvent.pointerDown(target, { button: 0, clientX: 100, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 100 + dx, clientY: 10 });
  fireEvent.pointerUp(window, { clientX: 100 + dx, clientY: 10 });
}

describe("/timeline", () => {
  beforeEach(() => {
    resetPlanning();
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-03T10:00:00Z") });
  });

  it("draws the work and keeps its view in the address", async () => {
    const user = userEvent.setup();
    open("/timeline");
    expect(await screen.findByTestId("gantt-bar-TSK-00001")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Project timeline/ })).toBeInTheDocument();
    await user.click(screen.getByText("Person"));
    expect(screen.getByTestId("where")).toHaveTextContent("group=assignee");
    await user.click(screen.getByText("Month"));
    expect(screen.getByTestId("where")).toHaveTextContent("zoom=month");
    await user.click(screen.getByRole("switch", { name: "Highlight the critical path" }));
    expect(screen.getByTestId("where")).toHaveTextContent("critical=0");
    await user.click(screen.getByRole("switch", { name: "Show finished work" }));
    expect(screen.getByTestId("where")).toHaveTextContent("done=0");
    await user.type(screen.getByRole("searchbox", { name: "Search the timeline" }), "API");
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("q=API"));
    await user.click(screen.getByText("Week"));
    await user.click(screen.getByTitle("Project"));
    expect(screen.getByTestId("where")).not.toHaveTextContent("zoom=");
    await user.click(screen.getByRole("button", { name: /Sprints/ }));
    expect(screen.getByText("the sprints")).toBeInTheDocument();
  });

  it("warns when a move breaks a dependency, and shifts the dependants on request", async () => {
    const user = userEvent.setup();
    open();
    const target = await screen.findByTestId("gantt-bar-TSK-00001");
    drag(target, ZOOMS.day.px * 2);
    const warning = await screen.findByTestId("timeline-warning");
    expect(warning).toHaveTextContent("TSK-00002 Build the API starts 4 Sep, before TSK-00001 ends 5 Sep");
    await user.click(within(warning).getByRole("button", { name: "Shift dependants" }));
    expect(await screen.findByText("1 dependent task moved along")).toBeInTheDocument();
    const last = planningState.calls.at(-1)!;
    expect(last.url).toBe("/platform/api/tasks/t-a/schedule");
    expect(last.body).toMatchObject({ start_date: "2026-09-03", due_date: "2026-09-05", shift_dependants: true });
    await waitFor(() => expect(screen.queryByTestId("timeline-warning")).not.toBeInTheDocument());
  });

  it("confirms a clean move with an undo", async () => {
    const user = userEvent.setup();
    open();
    drag(await screen.findByTestId("gantt-bar-TSK-00002"), ZOOMS.day.px);
    expect(await screen.findByText(/TSK-00002 now runs 5 Sep – 9 Sep/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(planningState.calls.at(-1)!.body).toMatchObject({ start_date: "2026-09-04", due_date: "2026-09-08" }),
    );
  });

  it("links two bars, warns about a backwards link, and removes one after asking", async () => {
    const user = userEvent.setup();
    open();
    const milestone = await screen.findByTestId("gantt-bar-TSK-00003");
    let under: Element = milestone;
    const restore = pointAt(() => under);
    fireEvent.pointerDown(screen.getByTestId("gantt-connector-TSK-00002"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 10 });
    expect(await screen.findByText("TSK-00003 now waits on TSK-00002")).toBeInTheDocument();

    under = screen.getByTestId("gantt-bar-TSK-00001");
    fireEvent.pointerDown(screen.getByTestId("gantt-connector-TSK-00002"), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 10 });
    restore();
    const warning = await screen.findByTestId("timeline-warning");
    await user.click(within(warning).getByRole("button", { name: "Keep as is" }));
    expect(screen.queryByTestId("timeline-warning")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Dependency TSK-00001 → TSK-00002/ }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    await waitFor(() => expect(planningState.calls.some((call) => call.method === "DELETE")).toBe(true));
    expect(await screen.findByText("Dependency removed")).toBeInTheDocument();
  });

  it("opens a task, says when nothing is scheduled, and when the read fails", async () => {
    const user = userEvent.setup();
    open();
    fireEvent.keyDown(await screen.findByTestId("gantt-bar-TSK-00002"), { key: "Enter" });
    expect(screen.getByText("the task")).toBeInTheDocument();

    server.use(http.get("/platform/api/work/timeline", () => HttpResponse.json({ ...planningState.timeline, groups: [], can_edit: false })));
    open();
    expect(await screen.findByText("Nothing scheduled in this window")).toBeInTheDocument();

    server.use(
      http.get("/platform/api/work/timeline", () => HttpResponse.json({ error: "server_error", message: "Down" }, { status: 500 })),
    );
    open("/timeline?group=epic");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    void user;
  });

  it("explains a refused move and a truncated chart", async () => {
    server.use(
      http.post("/platform/api/tasks/:id/schedule", () =>
        HttpResponse.json({ error: "conflict", message: "Somebody moved it first." }, { status: 409 }),
      ),
      http.get("/platform/api/work/timeline", () => HttpResponse.json({ ...planningState.timeline, truncated: true })),
    );
    open();
    expect(await screen.findByText(/Showing the first 3 bars/)).toBeInTheDocument();
    drag(screen.getByTestId("gantt-bar-TSK-00002"), ZOOMS.day.px);
    expect(await screen.findByText("Somebody moved it first.")).toBeInTheDocument();
  });
});
