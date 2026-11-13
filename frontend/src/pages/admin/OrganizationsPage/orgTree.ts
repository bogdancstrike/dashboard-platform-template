import type { DepartmentNode } from "@/api/organizations";

/**
 * Every department in a tree, flattened with its depth.
 *
 * Exported because it is what the "move into" picker offers, and the rule it
 * encodes is not obvious: a department cannot move into *itself or anything
 * below it*, so the excluded subtree has to be pruned before the options are
 * built. Offering the whole list and letting the server refuse would be a
 * control that produces an error on purpose.
 */
export function movableInto(
  nodes: DepartmentNode[],
  excluding: string,
  maxDepth: number,
): Array<{ id: string; label: string; depth: number }> {
  const out: Array<{ id: string; label: string; depth: number }> = [];
  const walk = (list: DepartmentNode[]) => {
    for (const node of list) {
      if (node.id === excluding) continue;
      // A parent at the last level has nowhere to put a child.
      if (node.depth < maxDepth - 1) {
        out.push({ id: node.id, label: node.name, depth: node.depth });
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * How a department's two people-counts read.
 *
 * One number here would be a lie in one direction or the other: its own
 * understates a parent, its subtree's makes the tree sum to more than the
 * company employs. So a parent says both.
 *
 * The wording is "in all" and not "below", which the first version said —
 * `people_in_subtree` *includes* the department itself, so "2 here, 7 below"
 * reads as nine people when there are seven. And there is no special case for
 * the two being equal: a parent whose children are all empty would then read
 * "5 below" when all five are in fact *here*. A uniform shape for every parent
 * is also the easier one to scan down a tree of forty rows.
 */
export function peopleLabel(node: DepartmentNode): string {
  if (node.children.length === 0) {
    return node.people === 1 ? "1 person" : `${node.people} people`;
  }
  return `${node.people} here, ${node.people_in_subtree} in all`;
}
