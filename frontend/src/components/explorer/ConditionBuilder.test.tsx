import { useState } from "react";
import { render, screen } from "@testing-library/react";
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
  it("starts as an empty root with an add-filter link", () => {
    render(<Harness />);
    expect(screen.getByRole("region", { name: "Root group" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add filter" })).toBeInTheDocument();
  });

  it("adds a filter, then a group with a filter of its own", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getByRole("button", { name: "+ Add filter" }));
    expect(treeStats(latest).rules).toBe(1);
    expect(screen.getByText("Where")).toBeInTheDocument();
    // An unfinished rule is muted, never explained at length.
    expect(screen.queryByText(/skipped until it is complete/)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: /incomplete/ })).toHaveClass("is-incomplete");

    await user.click(screen.getAllByRole("button", { name: "+ Add group" })[0]!);
    expect(treeStats(latest)).toMatchObject({ rules: 2, groups: 1, incomplete: 2 });
    expect(screen.getByRole("region", { name: "Group" })).toBeInTheDocument();
  });

  it("reads a tree back as lines with Where / and / or", () => {
    render(<Harness initial={sample} />);
    expect(screen.getAllByText("Where")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /^and — switch to or/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^or — switch to and/ })).toBeInTheDocument();
    expect(screen.getAllByRole("group", { name: /^Rule:/ })).toHaveLength(3);
  });

  it("flips a group's connective from its word, and negates it from the menu", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getByRole("button", { name: /^and — switch to or/ }));
    expect(conjunctionOf(latest!)).toBe("OR");

    await user.click(screen.getByRole("button", { name: "Root group options" }));
    await user.click(await screen.findByText("Exclude matches (NOT)"));
    expect(isNot(latest!)).toBe(true);
    expect(screen.getByText("Where not")).toBeInTheDocument();
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

  it("removes a nested group from its options menu", async () => {
    const user = userEvent.setup();
    let latest: QueryNode | null = null;
    render(<Harness initial={sample} onTree={(tree) => (latest = tree)} />);

    await user.click(screen.getByRole("button", { name: "Group options" }));
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
