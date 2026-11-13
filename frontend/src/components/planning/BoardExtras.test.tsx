import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Routes } from "react-router-dom";

import TasksBoardPage from "@/pages/entities/TasksBoardPage";
import { CommandProvider } from "@/commands/CommandContext";
import { planningState, resetPlanning } from "@/test/handlers/planning";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

import {
  ageDots,
  CardBadges,
  laneKey,
  parseLane,
  QuickCreate,
  ShortcutsModal,
  swimlaneOrder,
  swimOf,
  TemplatePicker,
  useBoardShortcuts,
  WipBadge,
  WipLimitsModal,
} from "./BoardExtras";

beforeEach(() => resetPlanning());

describe("board helpers", () => {
  it("names lanes by swimlane and status, and reads them back", () => {
    expect(laneKey("u-1", "NEW")).toBe("u-1|NEW");
    expect(parseLane("u-1|IN_REVIEW")).toEqual({ swim: "u-1", status: "IN_REVIEW" });
    expect(parseLane("DONE")).toEqual({ swim: "all", status: "DONE" });
    expect(swimOf({ priority: "HIGH" }, "priority")).toBe("HIGH");
    expect(swimOf({ assignee_id: null }, "assignee")).toBe("");
    expect(swimOf({}, "none")).toBe("all");
  });

  it("orders swimlanes: priorities by severity, the rest by name, none last", () => {
    expect(swimlaneOrder(["LOW", "CRITICAL", "LOW", "NORMAL"], "priority", (k) => k)).toEqual(["CRITICAL", "NORMAL", "LOW"]);
    expect(swimlaneOrder(["", "b", "a"], "epic", (k) => k.toUpperCase())).toEqual(["a", "b", ""]);
    expect(swimlaneOrder(["x"], "none", (k) => k)).toEqual(["all"]);
  });

  it("ages a card in dots, red after a fortnight", () => {
    const now = Date.parse("2026-09-30T00:00:00Z");
    expect(ageDots(null, now)).toEqual({ dots: 0, days: 0, stale: false });
    expect(ageDots("2026-09-29T00:00:00Z", now).dots).toBe(0);
    expect(ageDots("2026-09-27T00:00:00Z", now).dots).toBe(1);
    expect(ageDots("2026-09-25T00:00:00Z", now).dots).toBe(2);
    expect(ageDots("2026-09-20T00:00:00Z", now).dots).toBe(3);
    expect(ageDots("2026-09-01T00:00:00Z", now)).toMatchObject({ dots: 4, stale: true });
  });

  it("draws badges and the WIP count", () => {
    renderWithProviders(
      <>
        <CardBadges task={{ story_points: 5, blocked_reason: "Vendor", checklist: [{ done: true }, { done: false }] }} epicName="Billing" />
        <WipBadge count={3} setting={{ status: "IN_PROGRESS", wip_limit: 2, count: 3, over_limit: true }} />
        <WipBadge count={1} setting={{ status: "NEW", wip_limit: null, count: 1, over_limit: false }} />
      </>,
    );
    expect(screen.getByTestId("card-flag")).toHaveTextContent("Vendor");
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByTestId("card-checklist")).toHaveTextContent("1/2");
    expect(screen.getByLabelText("5 points")).toBeInTheDocument();
    expect(screen.getByTestId("wip-IN_PROGRESS")).toHaveClass("is-over");
    expect(screen.queryByTestId("wip-NEW")).not.toBeInTheDocument();
  });
});

describe("board controls", () => {
  it("adds a card inline, and Escape closes the input", async () => {
    const user = userEvent.setup();
    const created = vi.fn();
    let body: Record<string, unknown> | null = null;
    server.use(
      http.post("/platform/api/records/task", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: "t-q", subtitle: "TSK-00999", fields: [] }, { status: 201 });
      }),
    );
    renderWithProviders(<QuickCreate status="IN_REVIEW" extra={{ priority: "HIGH" }} onCreated={created} />);
    await user.click(screen.getByTestId("quick-add-IN_REVIEW"));
    await user.type(screen.getByTestId("quick-input-IN_REVIEW"), "Check the rollout{Enter}");
    await waitFor(() => expect(created).toHaveBeenCalledWith("t-q"));
    expect(body).toEqual({ title: "Check the rollout", status: "IN_REVIEW", priority: "HIGH" });
    expect(await screen.findByText("TSK-00999 added")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("quick-input-IN_REVIEW"), { key: "Escape" });
    expect(screen.getByTestId("quick-add-IN_REVIEW")).toBeInTheDocument();
  });

  it("explains an inline add the server refused", async () => {
    const user = userEvent.setup();
    server.use(http.post("/platform/api/records/task", () => HttpResponse.json({ error: "forbidden", message: "Not allowed." }, { status: 403 })));
    renderWithProviders(<QuickCreate status="NEW" />);
    await user.click(screen.getByTestId("quick-add-NEW"));
    await user.type(screen.getByTestId("quick-input-NEW"), "X{Enter}");
    expect(await screen.findByText("Not allowed.")).toBeInTheDocument();
  });

  it("sets lane limits", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    renderWithProviders(<WipLimitsModal open onClose={close} />);
    const input = await screen.findByRole("spinbutton", { name: "Limit for NEW" });
    await user.type(input, "6");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(planningState.calls.at(-1)!.body).toEqual({ limits: { NEW: 6, IN_PROGRESS: 1 } });
  });

  it("creates a task from a template", async () => {
    const user = userEvent.setup();
    const created = vi.fn();
    renderWithProviders(<TemplatePicker open onClose={() => undefined} onCreated={created} />);
    await user.click(await screen.findByText("Bug triage"));
    const title = screen.getByRole("textbox", { name: "Title" });
    await user.clear(title);
    await user.type(title, "Triage: login loop");
    await user.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(created).toHaveBeenCalledWith("t-new"));
    expect(planningState.calls.at(-1)!.body).toMatchObject({ title: "Triage: login loop" });
  });

  it("answers the board's keys, and ignores them while typing", () => {
    const create = vi.fn();
    const help = vi.fn();
    function Harness() {
      useBoardShortcuts({ onCreate: create, onHelp: help });
      return (
        <>
          <input aria-label="typing" data-board-search />
          <button data-board-card>one</button>
          <button data-board-card>two</button>
        </>
      );
    }
    renderWithProviders(<Harness />);
    fireEvent.keyDown(window, { key: "c" });
    expect(create).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "j" });
    expect(document.activeElement).toHaveTextContent("one");
    fireEvent.keyDown(document.activeElement!, { key: "j" });
    expect(document.activeElement).toHaveTextContent("two");
    fireEvent.keyDown(document.activeElement!, { key: "k" });
    expect(document.activeElement).toHaveTextContent("one");
    fireEvent.keyDown(window, { key: "?" });
    expect(help).toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toHaveAttribute("aria-label", "typing");
    fireEvent.keyDown(document.activeElement!, { key: "c" });
    expect(create).toHaveBeenCalledTimes(1);
    renderWithProviders(<ShortcutsModal open onClose={() => undefined} />);
    expect(screen.getByText("Next / previous card")).toBeInTheDocument();
  });
});

describe("the task board's planning features", () => {
  function render(route = "/tasks") {
    return renderWithProviders(
      <CommandProvider>
        <Routes>
          <Route path="/tasks" element={<TasksBoardPage />} />
          <Route path="/tasks/:id" element={<div>the task</div>} />
          <Route path="/timeline" element={<div>the timeline</div>} />
        </Routes>
      </CommandProvider>,
      { route },
    );
  }

  it("offers views, swimlanes, limits and templates", async () => {
    const user = userEvent.setup();
    render();
    const toolbar = await screen.findByTestId("board-toolbar");
    await screen.findByTestId("task-board");
    await user.click(screen.getByTestId("task-from-template"));
    expect(await screen.findByText("Bug triage")).toBeInTheDocument();
    await user.click(within(toolbar).getByRole("button", { name: "Lane limits" }));
    expect(await screen.findByRole("spinbutton", { name: "Limit for NEW" })).toBeInTheDocument();
    await user.click(within(toolbar).getByText("Timeline"));
    expect(screen.getByText("the timeline")).toBeInTheDocument();
  });

  it("splits the board into swimlanes by priority", async () => {
    render("/tasks?swim=priority");
    await screen.findByTestId("task-board");
    await waitFor(() => expect(document.querySelectorAll("[data-testid^='swimlane-']").length).toBeGreaterThan(0));
    expect(document.querySelector("[data-drop-list*='|']")).not.toBeNull();
  });
});
