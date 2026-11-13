import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ExplorerField } from "@/api/explorer";

import { ConditionBuilder } from "./ConditionBuilder";
import { children, ruleParts, treeStats } from "./conditionTree";
import type { QueryNode } from "./queryTree";

/**
 * The value half of a rule, for every kind of field and operator (§5), and the
 * drag that moves a rule between groups.
 *
 * `ConditionBuilder.test.tsx` covers the tree's shape; this covers what the
 * reader types into it — a list of choices, a range of dates, a number, a
 * yes/no — because a value editor that writes the wrong shape compiles to a
 * question the server answers wrongly without complaint.
 */
const field = (name: string, label: string, kind: ExplorerField["kind"], choices: string[] = []): ExplorerField =>
  ({ name, label, kind, sortable: true, filterable: true, searchable: false, facet: false, operators: ["eq", "ne", "gt", "lt", "between", "in", "not_in", "empty"], choices });

const FIELDS: ExplorerField[] = [
  field("status", "Status", "enum", ["NEW", "IN_PROGRESS", "DONE"]),
  field("tags", "Tags", "array"),
  field("points", "Points", "number"),
  field("due", "Due", "datetime"),
  field("urgent", "Urgent", "bool"),
  field("title", "Title", "text"),
];

const rule = (id: string, name: string, operator: string, value: unknown[]): QueryNode => ({
  id,
  type: "rule",
  properties: { field: name, operator, value },
});

const tree = (...rules: QueryNode[]): QueryNode => ({
  id: "root",
  type: "group",
  properties: { conjunction: "AND", not: false },
  children1: Object.fromEntries(rules.map((item) => [item.id as string, item])),
});

function Harness({ initial, onTree }: { initial: QueryNode; onTree: (tree: QueryNode) => void }) {
  const [value, setValue] = useState<QueryNode | null>(initial);
  return (
    <ConditionBuilder
      fields={FIELDS}
      value={value}
      onChange={(next) => {
        setValue(next);
        onTree(next);
      }}
    />
  );
}

function show(initial: QueryNode) {
  const seen: { latest: QueryNode | null } = { latest: null };
  render(<Harness initial={initial} onTree={(next) => (seen.latest = next)} />);
  return seen;
}

const valueOf = (seen: { latest: QueryNode | null }, id: string) =>
  ruleParts(children(seen.latest!).find((child) => child.id === id)!).value;

async function choose(label: string | RegExp, option: string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  const item = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")].find(
      (node) => node.textContent === option,
    );
    if (!found) throw new Error(`${option} not offered`);
    return found;
  });
  await user.click(item);
}

describe("the value a rule compares with", () => {
  it("chooses several of an enum's values for 'is any of'", async () => {
    const seen = show(tree(rule("a", "status", "select_any_in", [[]])));
    await choose("Value for Status", "Done");
    expect(valueOf(seen, "a")).toEqual([["DONE"]]);
  });

  it("takes numbers for a number field's 'is not any of', dropping what is not a number", async () => {
    const seen = show(tree(rule("b", "points", "select_not_any_in", [[]])));
    const points = screen.getByRole("combobox", { name: "Value for Points" });
    fireEvent.change(points, { target: { value: "5" } });
    fireEvent.keyDown(points, { key: "Enter", code: "Enter", keyCode: 13 });
    await waitFor(() => expect(seen.latest).not.toBeNull());
    expect(valueOf(seen, "b")).toEqual([[5]]);
  });

  it("asks for nothing when the operator needs no value, or before a field is chosen", () => {
    show(tree(rule("a", "title", "is_empty", []), rule("b", "", "", [])));
    expect(screen.getByText("no value needed")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
  });

  it("takes a range of numbers for 'between'", () => {
    const seen = show(tree(rule("a", "points", "between", [null, null])));
    fireEvent.change(screen.getByLabelText("Value for Points, from"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Value for Points, to"), { target: { value: "8" } });
    expect(valueOf(seen, "a")).toEqual([2, 8]);
  });

  it("draws a range of dates for 'between'", () => {
    show(tree(rule("a", "due", "between", ["2026-01-01 09:00:00", null])));
    expect(screen.getByDisplayValue("2026-01-01 09:00")).toBeInTheDocument();
  });

  it("picks one enum value, and a yes or no", async () => {
    const seen = show(tree(rule("a", "status", "select_equals", [""]), rule("b", "urgent", "equal", [null])));
    await choose("Value for Status: not chosen", "In progress");
    expect(valueOf(seen, "a")).toEqual(["IN_PROGRESS"]);
    await choose("Value for Urgent", "No");
    expect(valueOf(seen, "b")).toEqual([false]);
  });

  it("takes a number, and shows a stored date", () => {
    const seen = show(tree(rule("a", "points", "equal", [3]), rule("b", "due", "less", ["2026-03-04 10:30:00"])));
    fireEvent.change(screen.getByLabelText("Value for Points"), { target: { value: "42" } });
    expect(valueOf(seen, "a")).toEqual([42]);
    expect(screen.getByDisplayValue("2026-03-04 10:30")).toBeInTheDocument();
  });
});

describe("choosing the field and the operator", () => {
  it("starts a rule on a field, then changes what it asks", async () => {
    const seen = show(tree(rule("a", "", "", [])));
    const user = userEvent.setup();
    await user.click(screen.getByRole("combobox", { name: "Field: not chosen" }));
    const option = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('.ant-select-item-option[title="Points"]');
      if (!found) throw new Error("Points not offered");
      return found;
    });
    await user.click(option);
    await waitFor(() => expect(ruleParts(children(seen.latest!)[0]!).field).toBe("points"));
    // And the operator, which the field's kind decides the words for.
    await user.click(screen.getByRole("combobox", { name: /^Operator/ }));
    const operators = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option")];
      if (found.length < 2) throw new Error("no operators");
      return found;
    });
    await user.click(operators[operators.length - 1]!);
    await waitFor(() => expect(ruleParts(children(seen.latest!)[0]!).operator).toBeTruthy());
  });
});

describe("dragging a rule", () => {
  it("moves a rule into another group by its grip", () => {
    const group: QueryNode = {
      id: "g",
      type: "group",
      properties: { conjunction: "OR", not: false },
      children1: { c: rule("c", "title", "like", ["x"]) },
    };
    const seen = show(tree(rule("a", "points", "equal", [1]), group));
    const [grip] = screen.getAllByRole("button", { name: "Drag to move this rule" });
    const data = { effectAllowed: "", setData: () => undefined, setDragImage: () => undefined };
    fireEvent.dragStart(grip!, { dataTransfer: data });
    const target = document.querySelector('[data-node="c"]')!;
    fireEvent.dragOver(target, { clientY: 1000, dataTransfer: data });
    fireEvent.drop(target, { dataTransfer: data });
    fireEvent.dragEnd(grip!);
    const root = children(seen.latest!);
    expect(root.map((child) => child.id)).toEqual(["g"]);
    // Before or after `c` depends on where the pointer is in the line, which
    // jsdom has no layout to say; either way it is now inside the group.
    expect(children(root[0]!).map((child) => child.id).sort()).toEqual(["a", "c"]);
  });

  it("drops onto the end of an empty group, and not into a group's own inside", () => {
    const empty: QueryNode = { id: "e", type: "group", properties: { conjunction: "AND", not: false }, children1: {} };
    const seen = show(tree(rule("a", "points", "equal", [1]), empty));
    const data = { effectAllowed: "", setData: () => undefined, setDragImage: () => undefined };

    // A group dragged over its own tail goes nowhere.
    const groupGrip = screen.getByRole("button", { name: "Drag to move this group" });
    fireEvent.dragStart(groupGrip, { dataTransfer: data });
    fireEvent.dragOver(document.querySelector('[data-node="e"] .nx-fd-cb-tail')!, { dataTransfer: data });
    fireEvent.dragEnd(groupGrip);
    expect(seen.latest).toBeNull();

    const ruleGrip = screen.getByRole("button", { name: "Drag to move this rule" });
    fireEvent.dragStart(ruleGrip, { dataTransfer: data });
    const inner = document.querySelector('[data-node="e"] .nx-fd-cb-tail')!;
    fireEvent.dragOver(inner, { dataTransfer: data });
    fireEvent.drop(inner, { dataTransfer: data });
    expect(treeStats(seen.latest).rules).toBe(1);
    expect(children(children(seen.latest!)[0]!).map((child) => child.id)).toEqual(["a"]);
  });
});
