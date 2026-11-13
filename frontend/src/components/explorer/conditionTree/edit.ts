import type { ExplorerField } from "@/api/explorer";

import { BUILDER_TYPE, builderOperators } from "../queryBuilderConfig";
import { emptyTree, type QueryNode } from "../queryTree";

import {
  Conjunction,
  MULTI_VALUE,
  NO_VALUE,
  children,
  conjunctionOf,
  containsId,
  findById,
  isGroup,
  isNot,
  ruleParts,
} from "./read";

export function newId(): string {
  return crypto.randomUUID();
}

export function newRule(): QueryNode {
  return { id: newId(), type: "rule", properties: { field: null, operator: null, value: [], valueSrc: [] } };
}

export function newGroup(conjunction: Conjunction = "AND"): QueryNode {
  return { id: newId(), type: "group", children1: {}, properties: { conjunction, not: false } };
}

export function asMap(list: QueryNode[]): Record<string, QueryNode> {
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

export function withFreshIds(node: QueryNode): QueryNode {
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
