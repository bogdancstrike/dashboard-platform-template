import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import TaskDetailPage from "@/pages/entities/TaskDetailPage";
import { CommandProvider } from "@/commands/CommandContext";
import { recordDetail, resetComments } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The task work page (§8, §18, §36).
 *
 * What is worth asserting is that it is a *work* page: the controls people use
 * every day write without opening a form, ticking a to-do is an edit to the
 * record, and the conversation is a round trip rather than local state.
 */
function render(route = "/tasks/task-1") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
        <Route path="/tasks" element={<div>the board</div>} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

afterEach(() => resetComments());

/**
 * The task this page is about.
 *
 * Given here rather than in the shared fixture: two other suites exist to
 * prove the *absent* body renders as an explanation, and a fixture that serves
 * both would make one of them silently pointless.
 */
const workedTask = {
  ...recordDetail,
  fields: recordDetail.fields.map((field) =>
    field.name === "description"
      ? { ...field, value: "Migrate the customer records, then verify the counts." }
      : field,
  ),
};

beforeEach(() => {
  server.use(
    http.get("/platform/api/records/task/:id", () => HttpResponse.json(workedTask)),
  );
});

/** Captures what the page wrote to the record. */
function capturePut(bodies: Record<string, unknown>[]) {
  server.use(
    http.put("/platform/api/records/:type/:id", async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      bodies.push(body);
      return HttpResponse.json({ ...workedTask, ...body });
    }),
  );
}

describe("the task work page", () => {
  it("shows the work, not a table of fields", async () => {
    render();

    // Description, checklist, conversation and history — the shape of the job
    // rather than the shape of the row.
    expect(await screen.findByText(/Migrate the customer records/)).toBeInTheDocument();
    expect(await screen.findByTestId("task-checklist")).toBeInTheDocument();
    expect(await screen.findByTestId("comment-thread")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
  });

  it("changes the status without opening a form", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePut(bodies);

    render();
    const side = await screen.findByTestId("task-side");
    await user.click(within(side).getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByTitle("DONE"));

    await waitFor(() => expect(bodies).toHaveLength(1));
    // With the version it read, so an edit against a task somebody else moved
    // is refused rather than applied over theirs (§73).
    expect(bodies[0]).toMatchObject({
      status: "DONE",
      expected_updated_at: recordDetail.updated_at,
    });
  });

  it("ticks a to-do by writing the record, not a second endpoint", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePut(bodies);

    render();
    const checklist = await screen.findByTestId("task-checklist");
    expect(within(checklist).getByTestId("checklist-progress")).toHaveTextContent("1 of 2");

    await user.click(within(checklist).getByRole("checkbox", { name: "Load them" }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.["checklist"]).toEqual([
      { text: "Export the old rows", done: true },
      { text: "Load them", done: true },
    ]);
  });

  it("adds a step to the checklist", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    capturePut(bodies);

    render();
    const checklist = await screen.findByTestId("task-checklist");
    await user.type(within(checklist).getByLabelText("New checklist item"), "Verify the counts");
    await user.click(within(checklist).getByRole("button", { name: /Add/ }));

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect((bodies[0]?.["checklist"] as unknown[]).at(-1)).toEqual({
      text: "Verify the counts",
      done: false,
    });
  });

  it("posts a comment and shows it in the thread", async () => {
    const user = userEvent.setup();
    render();

    const thread = await screen.findByTestId("comment-thread");
    expect(within(thread).getByText("Blocked on the migration script.")).toBeInTheDocument();
    // A reply is nested under what it answers.
    expect(thread.querySelector(".nu-comments--replies")).not.toBeNull();

    await user.type(within(thread).getByLabelText("Add a comment"), "Migration finished.");
    await user.click(within(thread).getByTestId("post-comment"));

    expect(await within(thread).findByText("Migration finished.")).toBeInTheDocument();
  });

  it("lets the author edit their own comment, and says it was edited", async () => {
    const user = userEvent.setup();
    render();

    const thread = await screen.findByTestId("comment-thread");
    // Only one comment is this reader's: the other has no Edit control at all.
    const editButtons = within(thread).getAllByRole("button", { name: "Edit" });
    expect(editButtons).toHaveLength(1);

    await user.click(editButtons[0]!);
    const box = within(thread).getByLabelText("Edit comment by Ada Administrator");
    await user.clear(box);
    await user.type(box, "Running it now.");
    await user.click(within(thread).getByRole("button", { name: "Save" }));

    expect(await within(thread).findByText("Running it now.")).toBeInTheDocument();
    expect(within(thread).getByText("· edited")).toBeInTheDocument();
  });

  it("explains a read-only conversation rather than offering a box that fails", async () => {
    server.use(
      http.get("/platform/api/comments", () =>
        HttpResponse.json({
          items: [],
          total: 0,
          resource_type: "task",
          resource_id: "task-1",
          can_comment: false,
        }),
      ),
    );

    render();

    expect(
      await screen.findByText("You can read this conversation but not add to it"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("post-comment")).not.toBeInTheDocument();
  });

  it("reloads the record when somebody else changed it first (§73)", async () => {
    const user = userEvent.setup();
    server.use(
      http.put("/platform/api/records/:type/:id", () =>
        HttpResponse.json(
          { error: "conflict", message: "Somebody else changed it.", details: {} },
          { status: 409 },
        ),
      ),
    );

    render();
    const side = await screen.findByTestId("task-side");
    await user.click(within(side).getByRole("combobox", { name: "Priority" }));
    await user.click(await screen.findByTitle("CRITICAL"));

    expect(await screen.findByText(/while you had it open/)).toBeInTheDocument();
  });
});
