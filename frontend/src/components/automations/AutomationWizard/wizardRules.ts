import type { AutomationAction } from "@/api/automations";
import type { QueryNode } from "@/components/explorer/queryTree";

import { actionProblem } from "../ActionListEditor";

export interface Details {
  name: string;
  description?: string;
  resource_type: string;
  severity: string;
}

/**
 * Why the wizard cannot advance from a given step, or null when it can.
 *
 * Pure and exported: "you may not save an automation that reaches nobody" is a
 * rule worth asserting directly rather than by driving three dialogs, and the
 * button's disabled state and its explanation then come from one place instead
 * of drifting apart.
 */
export function stepProblem(
  step: number,
  state: { condition: QueryNode | null; actions: AutomationAction[]; needs: Map<string, string[]> },
): string | null {
  if (step === 1) {
    const rules = countRules(state.condition);
    if (rules === 0) {
      return "Add at least one condition — an automation with none matches nothing.";
    }
    return null;
  }
  if (step === 2) {
    if (state.actions.length === 0) return "Add at least one action.";
    for (const action of state.actions) {
      const problem = actionProblem(action, state.needs.get(action.kind) ?? []);
      if (problem) return problem;
    }
  }
  return null;
}

/** Complete rules in a tree — the browser's count, for enabling a button. */
function countRules(tree: QueryNode | null): number {
  if (!tree) return 0;
  const node = tree as { type?: string; children1?: unknown; properties?: { field?: string } };
  if ((node.type ?? "group") === "rule") return node.properties?.field ? 1 : 0;
  const children = node.children1;
  const list = Array.isArray(children)
    ? children
    : children && typeof children === "object"
      ? Object.values(children)
      : [];
  return list.reduce<number>((total, child) => total + countRules(child as QueryNode), 0);
}

export const STEPS = [
  { title: "Watch", description: "Which records" },
  { title: "When", description: "The condition" },
  { title: "Then", description: "What it does" },
  { title: "Check", description: "A rehearsal" },
];
