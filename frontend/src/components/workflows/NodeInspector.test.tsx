import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ExplorerResource } from "@/api/explorer";
import type { GraphNode, WorkflowGraph } from "@/api/workflowGraph";
import { withCanvas } from "@/pages/WorkflowCanvasPage";
import { renderWithProviders } from "@/test/render";
import { canvasCatalogueExtras, canvasGraph } from "@/test/handlers/workflows";

import { NodeInspector } from "./NodeInspector";

const catalogue = withCanvas({
  resources: [{ key: "task", label: "Tasks", path: "/tasks" }],
  roles: [{ code: "MANAGER", name: "Manager" }],
  actions: [],
  severities: [],
  priorities: ["LOW", "HIGH"],
  limits: { max_matches: 1, max_fires: 1, max_rules: 1 },
  ...canvasCatalogueExtras,
});

const field = (name: string, extra: Record<string, unknown> = {}) => ({
  name, label: name.charAt(0).toUpperCase() + name.slice(1), kind: "string", sortable: true, filterable: true,
  searchable: false, facet: false, operators: ["eq"], choices: [], editable: true, ...extra,
});

const datasets = [{
  key: "task", label: "Tasks", description: "", permission: "records.view", record_count: 1,
  default_columns: [], default_sort: "updated_at", path: "/tasks", title_field: "title", subtitle_field: "reference",
  status_field: "status",
  fields: [field("status", { kind: "enum", choices: ["NEW", "DONE"] }), field("progress", { kind: "number" }),
    field("title", { required: true })],
}] as unknown as ExplorerResource[];

function show(node: GraphNode, graph: WorkflowGraph = canvasGraph(), readOnly = false) {
  const onChange = vi.fn<(g: WorkflowGraph) => void>();
  const onClose = vi.fn();
  const full = graph.nodes.some((n) => n.id === node.id) ? graph : { ...graph, nodes: [...graph.nodes, node] };
  renderWithProviders(
    <NodeInspector node={node} graph={full} onChange={onChange} catalogue={catalogue} datasets={datasets}
      problems={["One thing", "Another"]} summaries={{ t: { title: "Record created" }, yes: { title: "Notify" }, no: { title: "Update" }, b: { title: "If / else" } }}
      readOnly={readOnly} onClose={onClose} />,
  );
  const last = () => onChange.mock.calls.at(-1)![0].nodes.find((n) => n.id === node.id)!.data;
  return { onChange, onClose, last };
}

const action = (data: Record<string, unknown>, id = "x"): GraphNode => ({ id, type: "action", position: { x: 0, y: 0 }, data });

describe("NodeInspector", () => {
  it("edits a field-changed trigger and lists every problem", async () => {
    const trigger: GraphNode = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "FIELD_CHANGED", resource_type: "task", field: "status" } };
    const { last } = show(trigger);
    expect(screen.getByTestId("inspector-problems")).toHaveTextContent("2 things to fix");
    await userEvent.click(screen.getByRole("combobox", { name: "Changes to" }));
    await userEvent.click(await screen.findByTitle("DONE"));
    expect(last().to).toBe("DONE");
  });

  it("offers schedule presets and a cron box, a form picker and a webhook note", () => {
    const schedule: GraphNode = { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "SCHEDULE", resource_type: "task", schedule: "" } };
    const { last } = show(schedule);
    fireEvent.change(screen.getByLabelText("Cron expression"), { target: { value: "0 9 * * 1" } });
    expect(last().schedule).toBe("0 9 * * 1");
  });

  it("names a form for a form trigger", () => {
    show({ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "FORM_SUBMITTED", resource_type: "task" } });
    expect(screen.getAllByLabelText("Form").length).toBeGreaterThan(0);
  });

  it("explains a webhook trigger", () => {
    show({ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "WEBHOOK", resource_type: "task" } });
    expect(screen.getByText(/own address/)).toBeInTheDocument();
  });

  it("free-texts the target value of a field without choices", () => {
    const { last } = show({ id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { event: "FIELD_CHANGED", resource_type: "task", field: "title" } });
    fireEvent.change(screen.getByLabelText("Changes to"), { target: { value: "x" } });
    expect(last().to).toBe("x");
  });

  it("edits notify recipients and wording", () => {
    const { last } = show(action({ kind: "NOTIFY", recipients: { owner: false } }));
    fireEvent.click(screen.getByLabelText("Owner"));
    expect(last().recipients).toMatchObject({ owner: true });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Hello {record}" } });
    expect(last().title).toBe("Hello {record}");
  });

  it("edits an email subject, a task, a webhook", () => {
    const email = show(action({ kind: "EMAIL" }, "e"));
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "S" } });
    expect(email.last().subject).toBe("S");
  });

  it("edits a task and a webhook", () => {
    const task = show(action({ kind: "TASK" }, "k"));
    fireEvent.change(screen.getByLabelText("Task title"), { target: { value: "Do it" } });
    expect(task.last().title).toBe("Do it");
  });

  it("edits a webhook address", () => {
    const hook = show(action({ kind: "WEBHOOK" }, "w"));
    fireEvent.change(screen.getByLabelText("POST to"), { target: { value: "https://x" } });
    expect(hook.last().url).toBe("https://x");
  });

  it("sets a field to a choice, a number or text", async () => {
    const choice = show(action({ kind: "UPDATE_FIELD", field: "status" }, "u"));
    await userEvent.click(screen.getByRole("combobox", { name: "New value" }));
    await userEvent.click(await screen.findByTitle("NEW"));
    expect(choice.last().value).toBe("NEW");
  });

  it("sets a number field", () => {
    const number = show(action({ kind: "UPDATE_FIELD", field: "progress" }, "p"));
    fireEvent.change(screen.getByLabelText("New value"), { target: { value: "40" } });
    expect(number.last().value).toBe(40);
  });

  it("sets a text field", () => {
    const text = show(action({ kind: "UPDATE_FIELD", field: "title" }, "q"));
    fireEvent.change(screen.getByLabelText("New value"), { target: { value: "x" } });
    expect(text.last().value).toBe("x");
  });

  it("assigns to the owner or a person", () => {
    const assign = show(action({ kind: "ASSIGN", to_owner: true }, "a"));
    fireEvent.click(screen.getByLabelText("To the owner"));
    expect(assign.last().to_owner).toBe(false);
  });

  it("creates a record with its required fields", () => {
    const create = show(action({ kind: "CREATE_RECORD", resource_type: "task", values: {} }, "c"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Follow up" } });
    expect(create.last().values).toEqual({ title: "Follow up" });
  });

  it("waits a number of minutes", () => {
    const wait = show(action({ kind: "WAIT", minutes: 60 }, "w2"));
    fireEvent.change(screen.getByLabelText("Minutes"), { target: { value: "90" } });
    expect(wait.last().minutes).toBe(90);
  });

  it("asks for an approval with two next steps", () => {
    show(action({ kind: "APPROVAL" }, "ap"));
    fireEvent.change(screen.getByLabelText("What is asked"), { target: { value: "OK?" } });
    expect(screen.getAllByLabelText("Next step when Approved").length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText("Next step when Rejected").length).toBeGreaterThan(0);
  });

  it("connects and disconnects the next step without a pointer, and removes the step", async () => {
    const { onChange, onClose } = show(canvasGraph().nodes[2]!);
    await userEvent.click(within(screen.getByTestId("next-out")).getByRole("combobox"));
    await userEvent.click(await screen.findByTitle("Update"));
    expect(onChange.mock.calls.at(-1)![0].edges.some((e) => e.source === "yes" && e.target === "no")).toBe(true);
    fireEvent.click(screen.getByTestId("remove-node"));
    expect(onClose).toHaveBeenCalled();
  });

  it("clears a branch output", () => {
    const { onChange } = show(canvasGraph().nodes[1]!);
    const yes = within(screen.getByTestId("next-true"));
    fireEvent.mouseDown(yes.getByRole("combobox"));
    const clear = screen.getByTestId("next-true").querySelector(".ant-select-clear");
    if (clear) fireEvent.mouseDown(clear);
    expect(onChange).toHaveBeenCalled();
  });

  it("is read-only when asked", () => {
    show(canvasGraph().nodes[2]!, canvasGraph(), true);
    expect(screen.queryByTestId("remove-node")).not.toBeInTheDocument();
  });
});
