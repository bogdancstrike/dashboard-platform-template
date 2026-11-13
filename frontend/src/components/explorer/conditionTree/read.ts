import { type QueryNode } from "../queryTree";

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

export function blank(value: unknown): boolean {
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
