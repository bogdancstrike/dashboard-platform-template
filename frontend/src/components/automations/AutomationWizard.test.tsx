import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";

import type { AutomationRule } from "@/api/automations";
import { AutomationWizard, stepProblem } from "@/components/automations/AutomationWizard";
import { blankAction } from "@/components/automations/ActionListEditor";
import type { QueryNode } from "@/components/explorer/queryTree";
import { renderWithProviders } from "@/test/render";
import { server } from "@/test/server";

/**
 * The new-automation wizard (§23): watch, when, then, check.
 *
 * The condition editor is the advanced search's query builder, which has its
 * own tests and a third-party DOM nobody should drive by class name; here it
 * is a stand-in that writes one complete rule, so what is exercised is the
 * wizard's own walk — what each step refuses, what it creates, and that the
 * creation is rehearsed before anybody switches it on.
 */
const RULE: QueryNode = {
  type: "group",
  id: "root",
  children1: { r1: { type: "rule", id: "r1", properties: { field: "status", operator: "equal", value: ["OPEN"] } } },
};

vi.mock("@/components/explorer/AdvancedQueryBuilder", () => ({
  AdvancedQueryBuilder: ({ onChange }: { onChange: (tree: QueryNode) => void }) => (
    <button type="button" onClick={() => onChange(RULE)}>
      Add the condition
    </button>
  ),
}));

const CATALOGUE = {
  resources: [
    { key: "task", label: "Tasks", path: "/tasks" },
    { key: "ticket", label: "Tickets", path: "/tickets" },
  ],
  roles: [{ code: "MANAGER", name: "Manager" }],
  actions: [
    { kind: "NOTIFY", label: "Notify people", description: "An in-app notification.", needs: ["recipients"] },
    { kind: "WEBHOOK", label: "Call a webhook", description: "One POST.", needs: ["url"] },
    { kind: "TASK", label: "Raise a task", description: "In the normal queue.", needs: [] },
  ],
  severities: ["INFO", "WARNING", "CRITICAL"],
  priorities: ["LOW", "NORMAL", "HIGH"],
  limits: { max_matches: 500, max_fires: 50, max_rules: 200 },
};

function open() {
  const onClose = vi.fn();
  const onCreated = vi.fn<(rule: AutomationRule) => void>();
  renderWithProviders(<AutomationWizard open catalogue={CATALOGUE} onClose={onClose} onCreated={onCreated} />);
  return { onClose, onCreated };
}

const next = () => screen.getByTestId("wizard-next");

describe("what stops each step", () => {
  const needs = new Map([
    ["NOTIFY", ["recipients"]],
    ["WEBHOOK", ["url"]],
  ]);

  it("wants a complete condition before the actions", () => {
    expect(stepProblem(1, { condition: null, actions: [], needs })).toMatch(/at least one condition/);
    const half = { type: "group", children1: [{ type: "rule", properties: {} }] } as unknown as QueryNode;
    expect(stepProblem(1, { condition: half, actions: [], needs })).toMatch(/at least one condition/);
    const nested = {
      type: "group",
      children1: [{ type: "group", children1: { a: { type: "rule", properties: { field: "x" } } } }],
    } as unknown as QueryNode;
    expect(stepProblem(1, { condition: nested, actions: [], needs })).toBeNull();
  });

  it("wants actions that reach somebody, and webhooks with an address", () => {
    expect(stepProblem(2, { condition: RULE, actions: [], needs })).toBe("Add at least one action.");
    const nobody = { ...blankAction("NOTIFY"), recipients: { user_ids: [], role: "", owner: false } };
    expect(stepProblem(2, { condition: RULE, actions: [nobody], needs })).toBe("Say who this reaches.");
    expect(stepProblem(2, { condition: RULE, actions: [{ ...blankAction("WEBHOOK"), url: "ftp://x" }], needs })).toMatch(/full http/);
    expect(stepProblem(2, { condition: RULE, actions: [blankAction("NOTIFY")], needs })).toBeNull();
    expect(stepProblem(0, { condition: null, actions: [], needs })).toBeNull();
  });
});

describe("the walk", () => {
  it("names it, conditions it, acts, creates it paused and rehearses it", async () => {
    const user = userEvent.setup();
    const created: Record<string, unknown>[] = [];
    server.use(
      http.post("/platform/api/automations/rules", async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        created.push(body);
        return HttpResponse.json({ ...body, id: "rule-new", trigger_count: 0, last_triggered_at: null }, { status: 201 });
      }),
    );
    const { onCreated } = open();

    // A name is required before anything else.
    await user.click(next());
    expect(await screen.findByText("Give it a name somebody will recognise")).toBeInTheDocument();
    await user.type(screen.getByLabelText("What is it watching for?"), "Tickets breaching SLA ⏱");
    await user.click(screen.getByText("Critical"));
    await user.click(next());

    // Step two: nothing to advance on until there is a rule.
    expect(await screen.findByText(/at least one condition/)).toBeInTheDocument();
    expect(next()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Add the condition" }));
    await waitFor(() => expect(next()).toBeEnabled());

    // Back keeps what was typed; forward again.
    await user.click(screen.getByTestId("wizard-back"));
    expect(screen.getByDisplayValue("Tickets breaching SLA ⏱")).toBeInTheDocument();
    await user.click(next());
    await user.click(next());

    // Step three: the default action notifies the record's owner.
    expect(next()).toHaveTextContent("Create it, paused");
    await user.click(next());

    const rehearsal = await screen.findByTestId("wizard-rehearsal");
    expect(within(rehearsal).getByText("Tickets breaching SLA ⏱ was created, paused")).toBeInTheDocument();
    expect(created[0]).toMatchObject({ name: "Tickets breaching SLA ⏱", severity: "CRITICAL", enabled: false, condition_tree: RULE });

    await user.click(next());
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "rule-new" }));
  });

  it("says so when the rehearsal cannot be run, and the rule is still made", async () => {
    const user = userEvent.setup();
    server.use(http.post("/platform/api/automations/rules/:id/run", () => HttpResponse.json({ message: "busy" }, { status: 503 })));
    open();
    fireEvent.change(screen.getByLabelText("What is it watching for?"), { target: { value: "Quiet" } });
    await user.click(next());
    await user.click(await screen.findByRole("button", { name: "Add the condition" }));
    await user.click(next());
    await user.click(next());
    expect(await screen.findByText("The rehearsal could not be run. Try it from the drawer.")).toBeInTheDocument();
  });

  it("reports a refused creation in the server's words", async () => {
    const user = userEvent.setup();
    server.use(
      http.post("/platform/api/automations/rules", () =>
        HttpResponse.json({ error: "conflict", message: "An automation with that name exists." }, { status: 409 }),
      ),
    );
    open();
    fireEvent.change(screen.getByLabelText("What is it watching for?"), { target: { value: "Dup" } });
    await user.click(next());
    await user.click(await screen.findByRole("button", { name: "Add the condition" }));
    await user.click(next());
    await user.click(next());
    expect(await screen.findByText("An automation with that name exists.")).toBeInTheDocument();
    expect(screen.queryByTestId("wizard-rehearsal")).not.toBeInTheDocument();
  });

  it("starts the condition again when the dataset changes", async () => {
    const user = userEvent.setup();
    open();
    fireEvent.change(screen.getByLabelText("What is it watching for?"), { target: { value: "Tickets" } });
    await user.click(screen.getByLabelText("Which records"));
    await user.click(await screen.findByText("Tickets", { selector: ".ant-select-item-option-content" }));
    await user.click(next());
    expect(await screen.findByText(/at least one condition/)).toBeInTheDocument();
  });

  it("asks before throwing away a half-made automation", async () => {
    const user = userEvent.setup();
    const { onClose } = open();
    await user.type(screen.getByLabelText("What is it watching for?"), "Half");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect((await screen.findAllByText("Discard your changes?")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Discard" }));
    expect(onClose).toHaveBeenCalled();
  });
});
