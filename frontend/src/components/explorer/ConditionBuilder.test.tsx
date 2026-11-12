import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
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
  it("starts as an empty root with a Condition button", () => {
    render(<Harness />);
    expect(screen.getByRole("region", { name: "Root group" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add a condition" })).toBeInTheDocument();
    expect(screen.getByText(/every record matches/)).toBeInTheDocument();
  });

  it("adds a condition, then a group with a condition of its own", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getByRole("button", { name: "Add a condition" }));
    expect(treeStats(latest).rules).toBe(1);
    // An unfinished rule is muted, never explained at length.
    expect(screen.queryByText(/skipped until it is complete/)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /incomplete/ })).toHaveClass("is-incomplete");

    await user.click(screen.getAllByRole("button", { name: "Add a group" })[0]!);
    expect(treeStats(latest)).toMatchObject({ rules: 2, groups: 1, incomplete: 2 });
    expect(screen.getByRole("region", { name: "Group" })).toBeInTheDocument();
  });

  it("reads a tree back as groups with All of / Any of", () => {
    render(<Harness initial={sample} />);
    const root = within(screen.getByRole("group", { name: "Root group: match all or any" }));
    expect(root.getByRole("button", { name: "All of" })).toHaveAttribute("aria-pressed", "true");
    const nested = within(screen.getByRole("group", { name: "Group: match all or any" }));
    expect(nested.getByRole("button", { name: "Any of" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByRole("group", { name: /^Rule:/ })).toHaveLength(3);
  });

  it("switches a group to Any of, and negates it with Not", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    const root = within(screen.getByRole("group", { name: "Root group: match all or any" }));
    await user.click(root.getByRole("button", { name: "Any of" }));
    expect(conjunctionOf(latest!)).toBe("OR");

    await user.click(screen.getAllByRole("checkbox", { name: "Not" })[0]!);
    expect(isNot(latest!)).toBe(true);
  });

  it("duplicates, moves and removes filters", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getAllByRole("button", { name: /^More for this rule/ })[0]!);
    await user.click(await screen.findByText("Duplicate this rule"));
    expect(treeStats(latest).rules).toBe(4);
    await user.click(screen.getAllByRole("button", { name: "Remove this rule" })[0]!);
    expect(treeStats(latest).rules).toBe(3);

    await user.click(screen.getByRole("button", { name: "More for this rule: Title" }));
    await user.click(await screen.findByText("Move up"));
    const moved = children(children(latest!).find((child) => child.id === "g")!);
    expect(ruleParts(moved[0]!).field).toBe("title");
  });

  it("types a text value", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    await user.type(screen.getByLabelText("Value for Title"), "audit");
    const group = children(latest!).find((child) => child.id === "g")!;
    expect(ruleParts(children(group)[1]!).value).toEqual(["audit"]);
  });

  it("removes a nested group with its bin", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getByRole("button", { name: "Remove this group" }));
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
