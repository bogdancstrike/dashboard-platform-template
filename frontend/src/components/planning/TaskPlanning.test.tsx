import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import TaskDetailPage from "@/pages/entities/TaskDetailPage";
import { CommandProvider } from "@/commands/CommandContext";
import { recordDetail } from "@/test/handlers";
import { planningState, resetPlanning } from "@/test/handlers/planning";
import "@/test/pointerShim";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * A task page's place in the plan (§18): the side card, subtasks,
 * dependencies, a reorderable checklist, and "save as template".
 */
const planned = {
  ...recordDetail,
  fields: [
    ...recordDetail.fields,
    { name: "project_id", label: "Project ID", kind: "uuid", value: "prj-1" },
    { name: "story_points", label: "Story points", kind: "number", value: 3, editable: true },
    { name: "start_date", label: "Start date", kind: "datetime", value: "2026-09-01T00:00:00Z", editable: true },
    { name: "epic_id", label: "Epic ID", kind: "uuid", value: "epic-1", editable: true },
    { name: "blocked_reason", label: "Blocked because", kind: "text", value: null, editable: true },
    { name: "cover_color", label: "Cover colour", kind: "text", value: null, editable: true },
    { name: "is_milestone", label: "Milestone", kind: "bool", value: false, editable: true },
  ],
};

let puts: Record<string, unknown>[] = [];

beforeEach(() => {
  resetPlanning();
  puts = [];
  server.use(
    http.get("/platform/api/records/task/:id", () => HttpResponse.json(planned)),
    http.put("/platform/api/records/:type/:id", async ({ request }) => {
      puts.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json(planned);
    }),
    http.post("/platform/api/records/task", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      puts.push({ created: body });
      return HttpResponse.json({ ...planned, id: "t-sub", subtitle: "TSK-00777" }, { status: 201 });
    }),
  );
});

function render() {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/tasks" element={<div>the board</div>} />
      </Routes>
    </CommandProvider>,
    { route: "/tasks/task-1" },
  );
}

describe("a task's place in the plan", () => {
  it("shows the plan and writes the record's own planning fields", async () => {
    const user = userEvent.setup();
    render();
    const side = await screen.findByTestId("task-planning");
    await waitFor(() => expect(within(side).getByText("OO")).toBeInTheDocument());
    expect(within(side).getByText("Does not repeat")).toBeInTheDocument();

    await user.click(within(side).getByRole("switch", { name: "Flag as blocked" }));
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ blocked_reason: "Blocked" }));
    await user.click(within(side).getByRole("switch", { name: "Milestone" }));
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ is_milestone: true }));
    await user.click(within(side).getByRole("button", { name: "Cover #dc2626" }));
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ cover_color: "#dc2626" }));
    await user.click(within(side).getByRole("button", { name: "No cover" }));
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ cover_color: null }));

    const points = within(side).getByRole("spinbutton", { name: "Story points" });
    await user.clear(points);
    await user.type(points, "8");
    fireEvent.blur(points);
    await waitFor(() => expect(puts.at(-1)).toMatchObject({ story_points: 8 }));
  });

  it("watches, and moves the task between sprints", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByTestId("task-watch"));
    expect(await screen.findByText("You will hear about changes to this task")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("task-watch")).toHaveTextContent("Stop watching"));
    await user.click(screen.getByTestId("task-watch"));
    expect(await screen.findByText("No longer watching")).toBeInTheDocument();

    const sprint = within(screen.getByTestId("task-planning")).getByRole("combobox", { name: "Sprint" });
    await user.click(sprint);
    await user.click(await screen.findByText("PRJ-0001 Sprint 6"));
    await waitFor(() =>
      expect(planningState.calls.find((call) => call.url.endsWith("/backlog/place"))?.body).toMatchObject({ task_id: "task-1", sprint_id: "sp-next" }),
    );
  });

  it("sets a repeat rule and takes it away again", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByTestId("task-repeat"));
    const dialog = await screen.findByRole("dialog", { name: "Repeat this task" });
    await user.click(within(dialog).getByText("Wed"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByTestId("task-recurrence")).toHaveTextContent("Every week on Mon"));
    expect(planningState.calls.at(-1)!.body).toMatchObject({ frequency: "WEEKLY", weekdays: [0, 2] });

    await user.click(screen.getByTestId("task-repeat"));
    const again = await screen.findByRole("dialog", { name: "Repeat this task" });
    await user.click(within(again).getByText("Monthly"));
    await user.click(within(again).getByText("Custom"));
    expect(within(again).getByRole("combobox", { name: "Unit" })).toBeInTheDocument();
    await user.click(within(again).getByText("Daily"));
    await user.click(within(again).getByRole("button", { name: "Stop repeating" }));
    expect(await screen.findByText("This task no longer repeats")).toBeInTheDocument();
  });

  it("lists subtasks and dependencies, adds a subtask and removes a dependency", async () => {
    const user = userEvent.setup();
    render();
    const subtasks = await screen.findByTestId("task-subtasks");
    expect(await within(subtasks).findByText("Write the migration")).toBeInTheDocument();
    await user.type(within(subtasks).getByRole("textbox", { name: "New subtask" }), "Verify counts{Enter}");
    expect(await screen.findByText("Subtask added")).toBeInTheDocument();
    expect(puts.at(-1)).toMatchObject({ created: { title: "Verify counts", parent_id: "task-1", project_id: "prj-1" } });

    const deps = screen.getByTestId("task-dependencies");
    expect(within(deps).getByText("Agree the contract")).toBeInTheDocument();
    expect(within(deps).getByText("Nothing waits on this.")).toBeInTheDocument();
    await user.click(within(deps).getByRole("button", { name: "Remove TSK-00009" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Dependency removed")).toBeInTheDocument();

    await user.click(within(deps).getByRole("combobox", { name: "Waits on" }));
    await user.click(await screen.findByText("TSK-00002 · Build the API"));
    await user.click(within(deps).getByRole("button", { name: /Link/ }));
    expect(await screen.findByText("Dependency added")).toBeInTheDocument();
  });

  it("reorders the checklist by keyboard and saves the new order", async () => {
    render();
    const row = await screen.findByTestId("checklist-row-1");
    const before = (planned.fields.find((field) => field.name === "checklist")!.value as { text: string }[]).map((item) => item.text);
    row.focus();
    fireEvent.keyDown(row, { key: " " });
    fireEvent.keyDown(row, { key: "ArrowUp" });
    fireEvent.keyDown(row, { key: " " });
    await waitFor(() => expect(puts.at(-1)).toHaveProperty("checklist"));
    const after = (puts.at(-1)!["checklist"] as { text: string }[]).map((item) => item.text);
    expect(after).toEqual([before[1], before[0], ...before.slice(2)]);
  });

  it("saves the task as a template", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByTestId("task-save-template"));
    const dialog = await screen.findByRole("dialog", { name: "Save as a template" });
    const name = within(dialog).getByRole("textbox", { name: "Template name" });
    await user.clear(name);
    await user.type(name, "Migration checklist");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved as the template “Migration checklist”")).toBeInTheDocument();
  });
});
