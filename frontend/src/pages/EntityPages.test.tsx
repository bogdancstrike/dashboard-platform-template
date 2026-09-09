import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { Route, Routes } from "react-router-dom";

import EntityDetailPage from "@/pages/EntityDetailPage";
import { CommandProvider } from "@/commands/CommandContext";
import { recordDetail } from "@/test/handlers";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

function renderDetail(route = "/tasks/task-1") {
  return renderWithProviders(
    <CommandProvider>
      <Routes>
        <Route path="/tasks" element={<div>the task list</div>} />
        <Route path="/tasks/:id" element={<EntityDetailPage resourceKey="task" />} />
      </Routes>
    </CommandProvider>,
    { route },
  );
}

describe("the generic entity detail page", () => {
  it("names the record rather than showing its id", async () => {
    renderDetail();

    expect(
      await screen.findByRole("heading", { name: /Review customer migration/ }),
    ).toBeInTheDocument();
    // Twice on purpose: once as the subtitle beside the name, once as the
    // Reference field in the details table.
    expect(screen.getAllByText("TSK-001").length).toBeGreaterThan(0);
    expect(screen.getByTestId("record-status")).toHaveTextContent("IN_PROGRESS");
  });

  it("renders every declared field, drawn by its kind", async () => {
    renderDetail();

    await screen.findByRole("heading", { name: /Review customer migration/ });
    // A number is localised, an enum is a tag, an absent value is an em dash
    // rather than the word "null".
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("null")).toBeNull();
  });

  it("puts identifiers and timestamps aside from the record's own attributes", async () => {
    renderDetail();

    const references = await screen.findByText("References");
    const panel = references.closest(".ant-card")!;
    // A detail page that opens with a UUID is one whose first line nobody reads.
    expect(within(panel as HTMLElement).getByText("Assignee ID")).toBeInTheDocument();
    expect(within(panel as HTMLElement).getByText("Created")).toBeInTheDocument();
  });

  it("shows the record's history from the scoped audit endpoint", async () => {
    const user = userEvent.setup();
    let requested: URLSearchParams | null = null;
    server.use(
      http.get("/platform/api/audit/timeline", ({ request }) => {
        requested = new URL(request.url).searchParams;
        return HttpResponse.json({
          items: [],
          total: 0,
          resource_type: "task",
          resource_id: "task-1",
          limit: 25,
        });
      }),
    );

    renderDetail();
    await user.click(await screen.findByRole("tab", { name: "History" }));

    await waitFor(() => expect(requested).not.toBeNull());
    expect(requested!.get("resource_type")).toBe("task");
    expect(requested!.get("resource_id")).toBe(recordDetail.id);
  });

  /**
   * The two things a record page is for besides its fields (§36, §50).
   *
   * Lazily, and that is the reason they are tabs: neither query runs until the
   * tab is opened, so a page whose reader only wanted the address does not
   * fetch a conversation and a graph to throw away.
   */
  it("carries the conversation and the connections, and asks for neither until asked", async () => {
    const user = userEvent.setup();
    const asked: string[] = [];
    server.use(
      http.get("/platform/api/comments", ({ request }) => {
        asked.push("comments");
        const params = new URL(request.url).searchParams;
        expect(params.get("resource_type")).toBe("task");
        expect(params.get("resource_id")).toBe(recordDetail.id);
        return HttpResponse.json({ items: [], total: 0, can_comment: true });
      }),
      http.get("/platform/api/relationships/:type/:id", () => {
        asked.push("relationships");
        return HttpResponse.json({
          root: {},
          total: 1,
          groups: [
            {
              direction: "outbound",
              relation: "project_id",
              label: "Project",
              total: 1,
              has_more: false,
              items: [
                {
                  id: "project-1",
                  entity: "project",
                  label: "Migration project",
                  summary: "ACTIVE",
                  explorable: true,
                },
              ],
            },
          ],
        });
      }),
    );

    renderDetail();
    await screen.findByRole("tab", { name: "Overview" });
    expect(asked).toEqual([]);

    await user.click(screen.getByRole("tab", { name: "Conversation" }));
    await waitFor(() => expect(asked).toContain("comments"));

    await user.click(screen.getByRole("tab", { name: "Connections" }));
    expect(await screen.findByText("Migration project")).toBeInTheDocument();
    expect(asked).toContain("relationships");
  });

  /**
   * The history widens to a thread (§48).
   *
   * A record's own history says when *it* changed; the thread says the
   * account it is filed against was edited an hour earlier — which is usually
   * the actual story, and reading it otherwise means opening four history
   * tabs and merging them by eye. Off by default, because "what happened to
   * this" is the question the tab is for.
   */
  it("widens the history to the records this one touches, and says whose it merged", async () => {
    const user = userEvent.setup();
    const asked: (string | null)[] = [];
    server.use(
      http.get("/platform/api/audit/timeline", ({ request }) => {
        const query = new URL(request.url).searchParams;
        asked.push(query.get("thread"));
        const own = {
          id: "audit-own",
          action: "UPDATE",
          result: "SUCCESS",
          actor_label: "Ada Administrator",
          impersonated: false,
          impersonator_label: "",
          resource_type: "task",
          resource_id: recordDetail.id,
          resource_label: "Review customer migration",
          message: "status raised",
          changes: [],
          occurred_at: "2026-09-06T09:00:00Z",
          ip_address: "",
          correlation_id: "",
        };
        const neighbour = {
          ...own,
          id: "audit-neighbour",
          resource_type: "customer",
          resource_label: "Lakeside Group",
          message: "the account was edited",
        };
        const thread = query.get("thread") === "true";
        return HttpResponse.json({
          items: thread ? [own, neighbour] : [own],
          total: thread ? 2 : 1,
          resource_type: "task",
          resource_id: recordDetail.id,
          limit: 25,
          thread,
          subjects: thread
            ? [
                { resource_type: "task", resource_id: recordDetail.id, label: "" },
                { resource_type: "customer", resource_id: "customer-1", label: "Lakeside Group" },
              ]
            : [{ resource_type: "task", resource_id: recordDetail.id, label: "" }],
        });
      }),
    );

    renderDetail();
    await user.click(await screen.findByRole("tab", { name: "History" }));

    // The record's own history first, and it does not repeat the record's name
    // on every row — every row is about the same record, and twelve copies of
    // its name is noise.
    expect(await screen.findByText("Ada Administrator")).toBeInTheDocument();
    expect(screen.queryByText("Lakeside Group")).not.toBeInTheDocument();
    await waitFor(() => expect(asked).toContain("false"));

    await user.click(screen.getByText("And what it touches"));

    // The joined record's entry, labelled with which record it belongs to,
    // and a count of what is being merged — a merged feed that cannot say
    // what it merged is one nobody can check.
    expect(await screen.findByText("Lakeside Group")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-subjects")).toHaveTextContent("2 records in this thread");
    await waitFor(() => expect(asked).toContain("true"));

    // And the entry really is the neighbour's: expanded, it says so.
    await user.click(screen.getByText("Lakeside Group"));
    expect(await screen.findByText("the account was edited")).toBeInTheDocument();
  });

  it("keeps the open tab in the URL", async () => {
    renderDetail("/tasks/task-1?tab=history");

    // Deep-linkable (§69): a colleague opening the link lands on the same tab.
    expect(await screen.findByRole("tab", { name: "History" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("says a record is missing rather than rendering an empty shell", async () => {
    server.use(
      http.get("/platform/api/records/:type/:id", () =>
        HttpResponse.json(
          { error: "not_found", message: "That task does not exist." },
          { status: 404 },
        ),
      ),
    );

    renderDetail();

    // A regex, because the back button inside the heading contributes its own
    // label to the accessible name.
    expect(await screen.findByRole("heading", { name: /Record not found/ })).toBeInTheDocument();
  });
});
