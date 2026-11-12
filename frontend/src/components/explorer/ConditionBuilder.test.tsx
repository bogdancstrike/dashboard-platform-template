import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { ExplorerField } from "@/api/explorer";
import { explorerCatalogue } from "@/test/handlers";

import { ConditionBuilder, fieldIcon, fieldKindLabel, humanise } from "./ConditionBuilder";
import { children, conjunctionOf, isNot, ruleParts, treeStats } from "./conditionTree";
import type { QueryNode } from "./queryTree";

const fields = explorerCatalogue.items[0]!.fields;

function Harness({ initial = null, onTree }: { initial?: QueryNode | null; onTree?: (tree: QueryNode) => void }) {
  const [tree, setTree] = useState<QueryNode | null>(initial);
  return (
    <ConditionBuilder
      fields={fields}
      value={tree}
      onChange={(next) => {
        setTree(next);
        onTree?.(next);
      }}
    />
  );
}

const rule = (id: string, field: string, operator: string, value: unknown[]): QueryNode => ({
  id,
  type: "rule",
  properties: { field, operator, value },
});

const sample: QueryNode = {
  id: "root",
  type: "group",
  properties: { conjunction: "AND", not: false },
  children1: {
    a: rule("a", "status", "select_equals", ["NEW"]),
    g: {
      id: "g",
      type: "group",
      properties: { conjunction: "OR", not: false },
      children1: {
        b: rule("b", "priority", "select_any_in", [["HIGH", "CRITICAL"]]),
        c: rule("c", "title", "like", [""]),
      },
    },
  },
};

describe("ConditionBuilder", () => {
  it("starts as an empty root that matches everything", () => {
    render(<Harness />);
    expect(screen.getByRole("region", { name: "Root group" })).toBeInTheDocument();
    expect(screen.getByText(/Matches every record/)).toBeInTheDocument();
  });

  it("adds a rule, then a group with a rule of its own", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getByRole("button", { name: /Add rule/ }));
    expect(treeStats(latest).rules).toBe(1);
    expect(screen.getByText(/Choose a field — this rule is skipped/)).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /Add group/ })[0]!);
    expect(treeStats(latest)).toMatchObject({ rules: 2, groups: 1, incomplete: 2 });
    expect(screen.getByRole("region", { name: "Group A" })).toBeInTheDocument();
  });

  it("reads a tree back as groups, connectives and rule rows", () => {
    render(<Harness initial={sample} />);
    expect(screen.getByRole("region", { name: "Group A" })).toBeInTheDocument();
    expect(screen.getAllByText(/of these 2 conditions/, { selector: ".nx-fd-cb-sentence" })).toHaveLength(2);
    // The text rule has no value yet, so it is flagged and skipped.
    expect(screen.getByText(/Choose a value — this rule is skipped/)).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: /^Rule:/ })).toHaveLength(3);
  });

  it("switches a group's connective and negates it", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    const root = within(screen.getByRole("group", { name: "Root group conjunction" }));
    await user.click(root.getByRole("button", { name: "Or" }));
    expect(conjunctionOf(latest!)).toBe("OR");

    const nots = screen.getAllByRole("button", { name: "Not" });
    await user.click(nots[0]!);
    expect(isNot(latest!)).toBe(true);
    expect(screen.getByText(/Exclude records matching/)).toBeInTheDocument();
  });

  it("duplicates and removes rules", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getAllByRole("button", { name: "Duplicate this rule" })[0]!);
    expect(treeStats(latest).rules).toBe(4);
    await user.click(screen.getAllByRole("button", { name: "Remove this rule" })[0]!);
    expect(treeStats(latest).rules).toBe(3);
  });

  it("types a text value and reorders with the keyboard", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    await user.type(screen.getByLabelText("Value for Title"), "audit");
    const group = children(latest!).find((child) => child.id === "g")!;
    expect(ruleParts(children(group)[1]!).value).toEqual(["audit"]);

    const handle = screen.getByRole("button", { name: "Reorder rule: Title" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    const moved = children(children(latest!).find((child) => child.id === "g")!);
    expect(ruleParts(moved[0]!).field).toBe("title");
  });

  it("removes a nested group from its options menu", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getByRole("button", { name: "Group A options" }));
    await user.click(await screen.findByText("Remove this group"));
    expect(treeStats(latest)).toMatchObject({ rules: 1, groups: 0 });
  });

  it("names field kinds and values for people", () => {
    const by = (kind: ExplorerField["kind"], extra: Partial<ExplorerField> = {}) =>
      ({ name: "x", label: "X", kind, ...extra }) as ExplorerField;
    expect(fieldIcon(by("enum"))).toBe("enum");
    expect(fieldIcon(by("datetime"))).toBe("date");
    expect(fieldIcon(by("number"))).toBe("number");
    expect(fieldIcon(by("bool"))).toBe("bool");
    expect(fieldIcon(by("array"))).toBe("tag");
    expect(fieldIcon(by("uuid", { references: "user" }))).toBe("rel");
    expect(fieldIcon(undefined)).toBe("text");
    expect(fieldKindLabel(by("datetime"))).toBe("Date");
    expect(fieldKindLabel(undefined)).toBe("Field");
    expect(humanise("IN_PROGRESS")).toBe("In progress");
  });
});
