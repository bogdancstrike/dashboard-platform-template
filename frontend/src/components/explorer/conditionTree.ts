/**
 * Edits on a condition tree, by node id, as plain JSON.
 *
 * The tree is the react-awesome-query-builder export the backend compiles
 * (`core/rules.py`): groups carry `properties.conjunction` / `properties.not`
 * and an id-keyed `children1`; rules carry `properties.field`, `operator` and a
 * `value` list. Every function here returns a new tree and never mutates its
 * argument, so the editor can hand each result straight to React state.
 */

import type { ExplorerField } from "@/api/explorer";

import { BUILDER_TYPE, builderOperators } from "./queryBuilderConfig";
import { emptyTree, type QueryNode } from "./queryTree";

export type Conjunction = "AND" | "OR";

/** Builder operators that take no value at all. */
export const NO_VALUE = new Set(["is_empty", "is_not_empty", "is_null", "is_not_null"]);
/** Builder operators whose one value is a list. */
export const MULTI_VALUE = new Set(["select_any_in", "select_not_any_in"]);

export function isGroup(node: QueryNode): boolean {
  return node.type === "group" || node.type === "rule_group" || (!node.type && Boolean(node.children1));
}

export function children(node: QueryNode): QueryNode[] {
  const raw = node.children1;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : Object.values(raw);
}

export function conjunctionOf(node: QueryNode): Conjunction {
  const raw = node.properties?.["conjunction"];
  return typeof raw === "string" && raw.toUpperCase() === "OR" ? "OR" : "AND";
}

export function isNot(node: QueryNode): boolean {
  return Boolean(node.properties?.["not"]);
}

export interface RuleParts {
  field: string;
  operator: string;
  value: unknown[];
}

export function ruleParts(node: QueryNode): RuleParts {
  const props = node.properties ?? {};
  return {
    field: typeof props["field"] === "string" ? props["field"] : "",
    operator: typeof props["operator"] === "string" ? props["operator"] : "",
    value: Array.isArray(props["value"]) ? (props["value"] as unknown[]) : [],
  };
}

function blank(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  return Array.isArray(value) && value.filter((item) => !blank(item)).length === 0;
}

/** Why a rule is skipped by the server, or `null` when it is complete. */
export function incompleteReason(node: QueryNode): "field" | "value" | null {
  const { field, operator, value } = ruleParts(node);
  if (!field) return "field";
  if (NO_VALUE.has(operator)) return null;
  if (operator === "between") return value.length < 2 || value.some(blank) ? "value" : null;
  return blank(value) ? "value" : null;
}

export interface TreeStats {
  rules: number;
  groups: number;
  incomplete: number;
}

/** Rules, nested groups (the root is not counted) and incomplete rules. */
export function treeStats(tree: QueryNode | null | undefined): TreeStats {
  const stats: TreeStats = { rules: 0, groups: 0, incomplete: 0 };
  const walk = (node: QueryNode, root: boolean) => {
    if (isGroup(node)) {
      if (!root) stats.groups += 1;
      children(node).forEach((child) => walk(child, false));
      return;
    }
    stats.rules += 1;
    if (incompleteReason(node)) stats.incomplete += 1;
  };
  if (tree) walk(tree, true);
  return stats;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function newRule(): QueryNode {
  return { id: newId(), type: "rule", properties: { field: null, operator: null, value: [], valueSrc: [] } };
}

export function newGroup(conjunction: Conjunction = "AND"): QueryNode {
  return { id: newId(), type: "group", children1: {}, properties: { conjunction, not: false } };
}

function asMap(list: QueryNode[]): Record<string, QueryNode> {
  return Object.fromEntries(list.map((child) => [child.id ?? newId(), child] as const));
}

/** The tree with ids on every node and `children1` as an id-keyed map. */
export function normalise(tree: QueryNode | null | undefined): QueryNode {
  const walk = (node: QueryNode): QueryNode => {
    const id = node.id ?? newId();
    if (!isGroup(node)) return { ...node, id, type: "rule" };
    return {
      ...node,
      id,
      type: "group",
      properties: { conjunction: conjunctionOf(node), not: isNot(node), ...node.properties },
      children1: asMap(children(node).map(walk)),
    };
  };
  return walk(tree ?? emptyTree());
}

/** Replace the node with `id` by `fn(node)`; `null` removes it. */
export function mapNode(
  tree: QueryNode,
  id: string,
  fn: (node: QueryNode) => QueryNode | QueryNode[] | null,
): QueryNode {
  if (tree.id === id) {
    const out = fn(tree);
    return Array.isArray(out) ? out[0] ?? tree : out ?? tree;
  }
  if (!isGroup(tree)) return tree;
  const next: QueryNode[] = [];
  for (const child of children(tree)) {
    if (child.id === id) {
      const out = fn(child);
      if (Array.isArray(out)) next.push(...out);
      else if (out) next.push(out);
    } else {
      next.push(mapNode(child, id, fn));
    }
  }
  return { ...tree, children1: asMap(next) };
}

export function removeNode(tree: QueryNode, id: string): QueryNode {
  return mapNode(tree, id, () => null);
}

export function appendChild(tree: QueryNode, groupId: string, child: QueryNode): QueryNode {
  return mapNode(tree, groupId, (group) => ({
    ...group,
    children1: asMap([...children(group), child]),
  }));
}

function withFreshIds(node: QueryNode): QueryNode {
  const copy: QueryNode = { ...structuredClone(node), id: newId() };
  if (isGroup(copy)) copy.children1 = asMap(children(copy).map(withFreshIds));
  return copy;
}

/** A copy of the node, with new ids, directly after it. */
export function duplicateById(tree: QueryNode, id: string): QueryNode {
  if (tree.id === id) return tree;
  return mapNode(tree, id, (node) => [node, withFreshIds(node)]);
}

export function setGroupProps(
  tree: QueryNode,
  id: string,
  patch: { conjunction?: Conjunction; not?: boolean },
): QueryNode {
  return mapNode(tree, id, (group) => ({ ...group, properties: { ...group.properties, ...patch } }));
}

/** Move a child within its own group to `index`. Unknown ids are a no-op. */
export function moveWithin(tree: QueryNode, groupId: string, id: string, index: number): QueryNode {
  return mapNode(tree, groupId, (group) => {
    const list = children(group);
    const from = list.findIndex((child) => child.id === id);
    if (from < 0) return group;
    const [item] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(index, list.length)), 0, item as QueryNode);
    return { ...group, children1: asMap(list) };
  });
}

/** The value list a rule should start with for an operator. */
export function emptyValueFor(operator: string): unknown[] {
  if (NO_VALUE.has(operator)) return [];
  if (operator === "between") return [null, null];
  if (MULTI_VALUE.has(operator)) return [[]];
  return [null];
}

/** Set a rule's field: the first operator that field allows, and no value. */
export function setRuleField(tree: QueryNode, id: string, field: ExplorerField): QueryNode {
  // The obvious comparison first: "Status is …", "Title contains …" — not
  // whichever operator the catalogue happens to list first ("is empty").
  const offered = builderOperators(field);
  const preferred = field.kind === "text" || field.kind === "array" || field.kind === "json" ? ["like", "equal"] : ["select_equals", "equal"];
  const operator = preferred.find((op) => offered.includes(op)) ?? offered[0] ?? "equal";
  return mapNode(tree, id, (rule) => ({
    ...rule,
    properties: {
      field: field.name,
      operator,
      value: emptyValueFor(operator),
      valueSrc: emptyValueFor(operator).map(() => "value"),
      valueType: emptyValueFor(operator).map(() => BUILDER_TYPE[field.kind]),
    },
  }));
}

/** Set a rule's operator, keeping the value when its shape still fits. */
export function setRuleOperator(tree: QueryNode, id: string, operator: string): QueryNode {
  return mapNode(tree, id, (rule) => {
    const parts = ruleParts(rule);
    const shape = (op: string) => (NO_VALUE.has(op) ? "none" : op === "between" ? "pair" : MULTI_VALUE.has(op) ? "list" : "one");
    const value = shape(parts.operator) === shape(operator) ? parts.value : emptyValueFor(operator);
    const type = (rule.properties?.["valueType"] as string[] | undefined)?.[0] ?? "text";
    return {
      ...rule,
      properties: {
        ...rule.properties,
        operator,
        value,
        valueSrc: value.map(() => "value"),
        valueType: value.map(() => type),
      },
    };
  });
}

export function setRuleValue(tree: QueryNode, id: string, value: unknown[]): QueryNode {
  return mapNode(tree, id, (rule) => {
    const type = (rule.properties?.["valueType"] as string[] | undefined)?.[0] ?? "text";
    return {
      ...rule,
      properties: {
        ...rule.properties,
        value,
        valueSrc: value.map(() => "value"),
        valueType: value.map(() => type),
      },
    };
  });
}

/** Letter labels for nested groups, in reading order: A, B, … Z, AA. */
export function groupLabels(tree: QueryNode): Map<string, string> {
  const labels = new Map<string, string>();
  let next = 0;
  const letter = (n: number): string => (n < 26 ? String.fromCharCode(65 + n) : letter(Math.floor(n / 26) - 1) + letter(n % 26));
  const walk = (node: QueryNode, root: boolean) => {
    if (!isGroup(node)) return;
    if (!root && node.id) labels.set(node.id, letter(next++));
    children(node).forEach((child) => walk(child, false));
  };
  walk(tree, true);
  return labels;
}

/**
 * The words an operator is read as in the builder.
 *
 * Words rather than symbols, because the builder is read as a sentence —
 * "Status is Offline", "Battery less than 20" — and datetime orderings read
 * as before / after.
 */
export function operatorWords(operator: string, kind?: string): string {
  const dated = kind === "datetime";
  switch (operator) {
    case "equal":
    case "select_equals":
      return "is";
    case "not_equal":
    case "select_not_equals":
      return "is not";
    case "like":
      return "contains";
    case "not_like":
      return "does not contain";
    case "starts_with":
      return "starts with";
    case "ends_with":
      return "ends with";
    case "less":
      return dated ? "before" : "less than";
    case "less_or_equal":
      return dated ? "on or before" : "at most";
    case "greater":
      return dated ? "after" : "more than";
    case "greater_or_equal":
      return dated ? "on or after" : "at least";
    case "between":
      return "between";
    case "select_any_in":
      return "is any of";
    case "select_not_any_in":
      return "is none of";
    case "is_empty":
    case "is_null":
      return "is empty";
    case "is_not_empty":
    case "is_not_null":
      return "is not empty";
    default:
      return operator.replaceAll("_", " ");
  }
}

/** Whether `id` is `node` itself or anywhere inside it. */
export function containsId(node: QueryNode, id: string): boolean {
  if (node.id === id) return true;
  return children(node).some((child) => containsId(child, id));
}

export function findById(tree: QueryNode, id: string): QueryNode | null {
  if (tree.id === id) return tree;
  for (const child of children(tree)) {
    const found = findById(child, id);
    if (found) return found;
  }
  return null;
}

/**
 * Move the node `id` into the group `targetGroupId` at `index` — the drag and
 * drop of the builder, within a group or across groups. A group cannot be
 * dropped into itself or its own descendants, and the root cannot move; both
 * are a no-op returning the tree unchanged.
 */
export function moveNode(tree: QueryNode, id: string, targetGroupId: string, index: number): QueryNode {
  if (tree.id === id) return tree;
  const node = findById(tree, id);
  const target = findById(tree, targetGroupId);
  if (!node || !target || !isGroup(target) || containsId(node, targetGroupId)) return tree;
  // Where it sat before, so an index in the same group accounts for the gap
  // its removal leaves.
  const siblings = children(target);
  const from = siblings.findIndex((child) => child.id === id);
  const at = from >= 0 && from < index ? index - 1 : index;
  const without = removeNode(tree, id);
  return mapNode(without, targetGroupId, (group) => {
    const list = children(group);
    list.splice(Math.max(0, Math.min(at, list.length)), 0, node);
    return { ...group, children1: asMap(list) };
  });
}
