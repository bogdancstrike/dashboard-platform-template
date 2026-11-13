/**
 * Every edit the condition builder makes, as an action on the tree.
 *
 * The builder's node components never build the next tree themselves: they
 * dispatch what the reader did — add, remove, duplicate, move, set a field —
 * and this decides what the tree becomes. One place for every way the tree can
 * change, and each case a pure function a test can call.
 */

import type { ExplorerField } from "@/api/explorer";

import type { QueryNode } from "../queryTree";
import {
  appendChild,
  duplicateById,
  mapNode,
  moveNode,
  moveWithin,
  removeNode,
  setGroupProps,
  setRuleField,
  setRuleOperator,
  setRuleValue,
} from "./edit";
import type { Conjunction } from "./read";

export type ConditionAction =
  | { type: "add"; group: string; node: QueryNode }
  | { type: "remove"; id: string }
  | { type: "duplicate"; id: string }
  | { type: "setGroup"; id: string; patch: { conjunction?: Conjunction; not?: boolean } }
  | { type: "moveWithin"; group: string; id: string; index: number }
  | { type: "move"; id: string; group: string; index: number }
  /** Put one rule inside a new group, in its place. */
  | { type: "wrap"; id: string; group: QueryNode }
  | { type: "clear"; id: string }
  | { type: "setField"; id: string; field: ExplorerField }
  | { type: "setOperator"; id: string; operator: string }
  | { type: "setValue"; id: string; value: unknown[] };

export function conditionReducer(tree: QueryNode, action: ConditionAction): QueryNode {
  switch (action.type) {
    case "add":
      return appendChild(tree, action.group, action.node);
    case "remove":
      return removeNode(tree, action.id);
    case "duplicate":
      return duplicateById(tree, action.id);
    case "setGroup":
      return setGroupProps(tree, action.id, action.patch);
    case "moveWithin":
      return moveWithin(tree, action.group, action.id, action.index);
    case "move":
      return moveNode(tree, action.id, action.group, action.index);
    case "wrap": {
      const { group } = action;
      return mapNode(tree, action.id, (rule) => appendChild(group, group.id as string, rule));
    }
    case "clear":
      return mapNode(tree, action.id, (group) => ({ ...group, children1: {} }));
    case "setField":
      return setRuleField(tree, action.id, action.field);
    case "setOperator":
      return setRuleOperator(tree, action.id, action.operator);
    case "setValue":
      return setRuleValue(tree, action.id, action.value);
  }
}
