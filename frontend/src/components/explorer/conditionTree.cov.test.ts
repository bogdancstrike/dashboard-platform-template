import { describe, expect, it } from "vitest";

import type { ExplorerField } from "@/api/explorer";

import {
  appendChild,
  children,
  conjunctionOf,
  duplicateById,
  emptyValueFor,
  groupLabels,
  incompleteReason,
  isGroup,
  isNot,
  mapNode,
  moveWithin,
  newGroup,
  newRule,
  normalise,
  operatorWords,
  removeNode,
  ruleParts,
  setGroupProps,
  setRuleField,
  setRuleOperator,
  setRuleValue,
  treeStats,
} from "./conditionTree";
import { countRules, duplicateNode, emptyTree, isEmptyTree, type QueryNode } from "./queryTree";

/**
 * The advanced builder's tree edits (§5): pure functions on the JSON the
 * server compiles, so every one can be checked without a React tree.
 */

function rule(id: string, field = "status", operator = "equal", value: unknown[] = ["OPEN"]): QueryNode {
  return { id, type: "rule", properties: { field, operator, value, valueType: ["text"] } };
}

function group(id: string, kids: QueryNode[], conjunction = "AND"): QueryNode {
  return {
    id,
    type: "group",
    properties: { conjunction, not: false },
    children1: Object.fromEntries(kids.map((kid) => [kid.id as string, kid])),
  };
}

const status: ExplorerField = {
  name: "status",
  label: "Status",
  kind: "enum",
  sortable: true,
  filterable: true,
  searchable: false,
  facet: true,
  operators: ["eq", "ne", "in", "empty"],
  choices: ["OPEN", "CLOSED"],
};

function ids(node: QueryNode): string[] {
  return children(node).map((child) => child.id as string);
}

describe("reading a tree", () => {
  it("tells groups from rules, in every shape the library writes", () => {
    expect(isGroup({ type: "group" })).toBe(true);
    expect(isGroup({ type: "rule_group" })).toBe(true);
    expect(isGroup({ children1: {} })).toBe(true);
    expect(isGroup({ type: "rule" })).toBe(false);
    expect(children({ children1: [rule("a")] })).toHaveLength(1);
    expect(children({ type: "rule" })).toEqual([]);
  });

  it("reads the conjunction, the negation and a rule's parts defensively", () => {
    expect(conjunctionOf({ properties: { conjunction: "or" } })).toBe("OR");
    expect(conjunctionOf({ properties: { conjunction: 3 } })).toBe("AND");
    expect(conjunctionOf({})).toBe("AND");
    expect(isNot({ properties: { not: true } })).toBe(true);
    expect(ruleParts({ properties: { field: 1, operator: null, value: "x" } })).toEqual({
      field: "",
      operator: "",
      value: [],
    });
  });

  it("says why a rule would be skipped", () => {
    expect(incompleteReason(rule("a", ""))).toBe("field");
    expect(incompleteReason(rule("a", "status", "is_empty", []))).toBeNull();
    expect(incompleteReason(rule("a", "n", "between", [1]))).toBe("value");
    expect(incompleteReason(rule("a", "n", "between", [1, ""]))).toBe("value");
    expect(incompleteReason(rule("a", "n", "between", [1, 2]))).toBeNull();
    expect(incompleteReason(rule("a", "s", "equal", [null]))).toBe("value");
    expect(incompleteReason(rule("a", "s", "select_any_in", [[]]))).toBe("value");
    expect(incompleteReason(rule("a", "s", "select_any_in", [["OPEN"]]))).toBeNull();
  });

  it("counts rules, nested groups and incomplete rules", () => {
    const tree = group("root", [rule("a"), group("g", [rule("b", ""), rule("c")])]);
    expect(treeStats(tree)).toEqual({ rules: 3, groups: 1, incomplete: 1 });
    expect(treeStats(null)).toEqual({ rules: 0, groups: 0, incomplete: 0 });
    expect(countRules(tree)).toBe(3);
    expect(countRules(undefined)).toBe(0);
    expect(isEmptyTree(emptyTree())).toBe(true);
    expect(isEmptyTree(tree)).toBe(false);
  });

  it("letters nested groups in reading order, past Z", () => {
    const many = Array.from({ length: 28 }, (_, index) => group(`g${index}`, []));
    const labels = groupLabels(group("root", many));
    expect(labels.get("g0")).toBe("A");
    expect(labels.get("g25")).toBe("Z");
    expect(labels.get("g26")).toBe("AA");
    expect(labels.get("g27")).toBe("AB");
    expect(labels.has("root")).toBe(false);
  });

  it("reads operators as words, with dates before and after", () => {
    const cases: [string, string | undefined, string][] = [
      ["equal", undefined, "is"],
      ["select_equals", undefined, "is"],
      ["not_equal", undefined, "is not"],
      ["select_not_equals", undefined, "is not"],
      ["like", undefined, "contains"],
      ["not_like", undefined, "does not contain"],
      ["starts_with", undefined, "starts with"],
      ["ends_with", undefined, "ends with"],
      ["less", undefined, "less than"],
      ["less", "datetime", "before"],
      ["less_or_equal", undefined, "at most"],
      ["less_or_equal", "datetime", "on or before"],
      ["greater", undefined, "more than"],
      ["greater", "datetime", "after"],
      ["greater_or_equal", undefined, "at least"],
      ["greater_or_equal", "datetime", "on or after"],
      ["between", undefined, "between"],
      ["select_any_in", undefined, "is any of"],
      ["select_not_any_in", undefined, "is none of"],
      ["is_empty", undefined, "is empty"],
      ["is_null", undefined, "is empty"],
      ["is_not_empty", undefined, "is not empty"],
      ["is_not_null", undefined, "is not empty"],
      ["some_new_thing", undefined, "some new thing"],
    ];
    for (const [operator, kind, words] of cases) {
      expect(operatorWords(operator, kind)).toBe(words);
    }
  });
});

describe("editing a tree", () => {
  it("normalises ids, group shape and list-shaped children", () => {
    const raw: QueryNode = {
      children1: [{ type: "rule", properties: { field: "a" } }, { children1: [] }],
      properties: { conjunction: "OR" },
    };
    const tree = normalise(raw);
    expect(tree.id).toBeTruthy();
    expect(tree.type).toBe("group");
    expect(conjunctionOf(tree)).toBe("OR");
    expect(Array.isArray(tree.children1)).toBe(false);
    expect(children(tree).every((child) => Boolean(child.id))).toBe(true);
    expect(normalise(null).type).toBe("group");
  });

  it("adds, removes and duplicates without touching the original", () => {
    const tree = group("root", [rule("a"), group("g", [rule("b")])]);
    const frozen = structuredClone(tree);

    const added = appendChild(tree, "g", rule("c"));
    expect(ids(children(added)[1]!)).toEqual(["b", "c"]);

    const removed = removeNode(added, "b");
    expect(ids(children(removed)[1]!)).toEqual(["c"]);

    const copied = duplicateById(tree, "a");
    expect(children(copied)).toHaveLength(3);
    expect(children(copied)[1]!.id).not.toBe("a");
    expect(ruleParts(children(copied)[1]!)).toEqual(ruleParts(rule("a")));
    // The root cannot be duplicated, and a group copy gets fresh ids all down.
    expect(duplicateById(tree, "root")).toBe(tree);
    const groupCopy = duplicateById(tree, "g");
    const [, original, clone] = children(groupCopy);
    expect(ids(clone!)).not.toEqual(ids(original!));

    expect(tree).toEqual(frozen);
  });

  it("maps the root itself, and returns it when asked to remove it", () => {
    const tree = group("root", []);
    expect(mapNode(tree, "root", () => null)).toBe(tree);
    expect(mapNode(tree, "root", (node) => [{ ...node, id: "x" }]).id).toBe("x");
    expect(mapNode(rule("a"), "nope", () => null).id).toBe("a");
  });

  it("changes a group's conjunction and negation", () => {
    const tree = group("root", [group("g", [])]);
    const changed = setGroupProps(tree, "g", { conjunction: "OR", not: true });
    const inner = children(changed)[0]!;
    expect(conjunctionOf(inner)).toBe("OR");
    expect(isNot(inner)).toBe(true);
  });

  it("moves a child within its group, clamped, and ignores unknown ids", () => {
    const tree = group("root", [rule("a"), rule("b"), rule("c")]);
    expect(ids(moveWithin(tree, "root", "a", 99))).toEqual(["b", "c", "a"]);
    expect(ids(moveWithin(tree, "root", "c", -5))).toEqual(["c", "a", "b"]);
    expect(ids(moveWithin(tree, "root", "zzz", 0))).toEqual(["a", "b", "c"]);
  });

  it("starts each operator with a value of the right shape", () => {
    expect(emptyValueFor("is_empty")).toEqual([]);
    expect(emptyValueFor("between")).toEqual([null, null]);
    expect(emptyValueFor("select_any_in")).toEqual([[]]);
    expect(emptyValueFor("equal")).toEqual([null]);
  });

  it("sets a field with its first operator, then keeps a value whose shape still fits", () => {
    const tree = group("root", [newRule()]);
    const id = children(tree)[0]!.id as string;

    const withField = setRuleField(tree, id, status);
    const parts = ruleParts(children(withField)[0]!);
    expect(parts).toEqual({ field: "status", operator: "select_equals", value: [null] });
    expect(children(withField)[0]!.properties?.["valueType"]).toEqual(["select"]);

    const withValue = setRuleValue(withField, id, ["OPEN"]);
    expect(ruleParts(children(withValue)[0]!).value).toEqual(["OPEN"]);

    // = to ≠ is the same shape, so the value survives…
    const flipped = setRuleOperator(withValue, id, "select_not_equals");
    expect(ruleParts(children(flipped)[0]!).value).toEqual(["OPEN"]);
    // …and = to "any of" is not, so it resets.
    const listed = setRuleOperator(flipped, id, "select_any_in");
    expect(ruleParts(children(listed)[0]!).value).toEqual([[]]);
    expect(ruleParts(children(setRuleOperator(listed, id, "is_null"))[0]!).value).toEqual([]);
    expect(ruleParts(children(setRuleOperator(listed, id, "between"))[0]!).value).toEqual([null, null]);
  });

  it("defaults a field with no mappable operators to equality", () => {
    const tree = group("root", [newRule()]);
    const id = children(tree)[0]!.id as string;
    const odd = setRuleField(tree, id, { ...status, operators: ["no-such-op"] });
    expect(ruleParts(children(odd)[0]!).operator).toBe("equal");
    // A rule without a declared value type is treated as text.
    const bare = group("root", [{ id: "r", type: "rule", properties: { field: "x", operator: "equal" } }]);
    expect(children(setRuleValue(bare, "r", ["v"]))[0]!.properties?.["valueType"]).toEqual(["text"]);
    expect(children(setRuleOperator(bare, "r", "like"))[0]!.properties?.["valueType"]).toEqual([]);
  });

  it("builds new rules and groups with their own ids", () => {
    expect(newRule().id).not.toBe(newRule().id);
    expect(conjunctionOf(newGroup("OR"))).toBe("OR");
    expect(conjunctionOf(newGroup())).toBe("AND");
  });
});

describe("duplicating by path (the builder's renderer)", () => {
  const tree = group("root", [rule("a"), group("g", [rule("b"), rule("c")])]);

  it("puts the copy right after the original, with fresh ids all down", () => {
    const copied = duplicateNode(tree, ["root", "g"])!;
    const order = ids(copied);
    expect(order[0]).toBe("a");
    expect(order[1]).toBe("g");
    expect(order).toHaveLength(3);
    const clone = children(copied)[2]!;
    expect(ids(clone)).toHaveLength(2);
    expect(ids(clone)).not.toContain("b");
  });

  it("reaches into nested groups, and is a no-op for a stale path or the root", () => {
    expect(countRules(duplicateNode(tree, ["root", "g", "b"]))).toBe(4);
    expect(duplicateNode(tree, ["root"])).toBeNull();
    expect(duplicateNode(tree, ["root", "missing", "b"])).toBeNull();
    expect(duplicateNode(tree, ["root", "g", "missing"])).toBeNull();
  });

  it("reads list-shaped children as well as maps", () => {
    const listed: QueryNode = { id: "root", type: "group", children1: [rule("x"), { type: "group", children1: [rule("y")] }] };
    expect(countRules(listed)).toBe(2);
    expect(countRules(duplicateNode(listed, ["root", "x"]))).toBe(3);
  });
});
